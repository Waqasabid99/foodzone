import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { Prisma } from "@/generated/prisma";
import { cursorArgs, toPage } from "@/lib/api/pagination";
import { withTransaction } from "@/server/utils/db";
import { recordAudit } from "@/server/utils/audit";
import { nextDocumentNumber, monthPeriodKey } from "@/server/utils/sequence";
import { postMovement } from "@/server/inventory/ledger";
import { enqueue } from "@/server/jobs/outbox";
import { convertQuantity, quantity as q, totalCost as tc, unitCost as uc } from "@/server/inventory/uom";
import { explodeRecipe, mergeLines } from "@/server/production/explode";
import { allocateOutputCosts, variance, yieldVariance } from "@/server/production/costing";
import { assertProductionTransition } from "@/server/production/state";
import { standardCostForRun } from "@/server/services/recipe-cost.service";
import { branchFilter } from "@/server/inventory/access";

/**
 * Production runs — the prep kitchen.
 *
 * A run turns raw stock into something else: flour and water into dough, bones
 * into stock, a whole lamb into portions. The lifecycle exists so the ledger
 * only ever says what physically happened:
 *
 *   PLANNED      a piece of paper. Nothing has moved.
 *   IN_PROGRESS  material has been issued: it is off the shelf and on the bench.
 *   COMPLETED    output is booked into stock at what it actually cost.
 *   CANCELLED    the run stopped; anything issued has gone back.
 *
 * Four decisions shape it:
 *
 *   * **Material is issued at start, not at completion.** That is what actually
 *     happens in a kitchen, and it means stock is not overstated for the hours
 *     a batch is proving. It also means a cancelled run has something real to
 *     put back, which is why cancellation reverses rather than deletes.
 *   * **Starting a run is refused if the material is not there.** Unlike a
 *     sale, which has already happened by the time the system hears about it, a
 *     run is a decision being taken now. Issuing flour that does not exist
 *     produces a negative balance nobody can explain later.
 *   * **The cost of the output is what the run actually cost**, from the FIFO
 *     or average cost of what was consumed, plus labour and overhead. Not the
 *     recipe's estimate — that is the *standard*, and the whole point is the
 *     gap between the two.
 *   * **Waste is booked, not absorbed.** A run that yields 18 usable litres out
 *     of 20 has two litres of cost in it. Spreading that silently over the good
 *     output makes the loss invisible; booking it as wastage against the run
 *     makes it a number somebody can be asked about.
 */

const D = (value) => new Prisma.Decimal(value ?? 0);
const ZERO = D(0);

const UOM_SELECT = { id: true, code: true, type: true, factor: true, baseUnitId: true, precision: true };

const SELECT = {
  id: true,
  productionNumber: true,
  branchId: true,
  locationId: true,
  recipeId: true,
  status: true,
  plannedQuantity: true,
  producedQuantity: true,
  wastedQuantity: true,
  materialCost: true,
  laborCost: true,
  overheadCost: true,
  totalCost: true,
  unitCost: true,
  standardCost: true,
  batchNumber: true,
  expiryDate: true,
  scheduledFor: true,
  startedAt: true,
  completedAt: true,
  supervisorId: true,
  createdById: true,
  notes: true,
  createdAt: true,
  location: { select: { id: true, name: true, code: true, branchId: true } },
  recipe: {
    select: {
      id: true,
      name: true,
      version: true,
      yieldQuantity: true,
      yieldUomId: true,
      outputItemId: true,
      laborCost: true,
      overheadCost: true,
      yieldUom: { select: UOM_SELECT },
      outputItem: {
        select: {
          id: true,
          sku: true,
          name: true,
          uomId: true,
          trackBatches: true,
          isPerishable: true,
          shelfLifeDays: true,
          uom: { select: UOM_SELECT },
        },
      },
    },
  },
  consumptions: {
    select: {
      id: true,
      itemId: true,
      batchId: true,
      plannedQuantity: true,
      quantity: true,
      unitCost: true,
      totalCost: true,
      consumedAt: true,
      item: { select: { id: true, sku: true, name: true, uom: { select: { id: true, code: true } } } },
    },
  },
  outputs: {
    select: {
      id: true,
      itemId: true,
      batchId: true,
      quantity: true,
      unitCost: true,
      totalCost: true,
      isPrimary: true,
      producedAt: true,
      item: { select: { id: true, sku: true, name: true, uom: { select: { id: true, code: true } } } },
    },
  },
};

async function allocateProductionNumber(tx, { branch }) {
  return nextDocumentNumber(tx, {
    documentType: "PRODUCTION_ORDER",
    branchId: branch.id,
    periodKey: monthPeriodKey(new Date(), branch.timezone),
    prefix: `PRD-${branch.code}`,
    padding: 4,
  });
}

async function loadRun(id, db = prisma) {
  const run = await db.productionOrder.findUnique({ where: { id }, select: SELECT });
  if (!run) throw ApiError.notFound("Production order not found");
  return run;
}

/**
 * Moves a run from one of `from` to `to`, or refuses.
 *
 * The status is claimed inside the transaction, before any stock moves: two
 * people pressing Start together would otherwise both read "planned" and
 * issue the material twice. The row lock makes the second wait, find the run
 * already moved, and stop here with nothing posted.
 */
async function claimRun(tx, id, { from, to = null, data = {} }) {
  const claimed = await tx.productionOrder.updateMany({
    where: { id, status: { in: from } },
    data: { ...(to ? { status: to } : {}), ...data, updatedAt: new Date() },
  });
  if (claimed.count > 0) return;

  const current = await tx.productionOrder.findUnique({ where: { id }, select: { status: true } });
  if (!current) throw ApiError.notFound("Production order not found");
  if (to) assertProductionTransition(current.status, to);
  throw ApiError.conflict(`This run is ${current.status.toLowerCase().replace(/_/g, " ")} now, so that cannot be done`, {
    status: current.status,
  });
}

/** The ids, once each, that a list of issue lines names — and each must be a live item. */
async function assertIssuable(lines) {
  const ids = lines.map((line) => line.itemId);
  if (new Set(ids).size !== ids.length) {
    throw ApiError.validation("An item is on the list twice", { items: ["Put each item on one line"] });
  }
  const items = await prisma.inventoryItem.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, isActive: true },
  });
  if (items.length !== ids.length) throw ApiError.validation("One or more items do not exist", { items: ["Check the items"] });
  const inactive = items.find((item) => !item.isActive);
  if (inactive) {
    throw ApiError.validation(`${inactive.name} is switched off`, { items: [`Switch ${inactive.name} back on first`] });
  }
}

/**
 * What a run of this recipe at this quantity should consume.
 *
 * The same explosion depletion and costing use, so a planned consumption and a
 * costed one can never disagree about how much beef a batch of meatballs takes.
 */
export async function planConsumption({ recipeId, quantity: qty, tx = prisma }) {
  const lines = await explodeRecipe({ recipeId, multiplier: qty, tx });
  return mergeLines(lines);
}

/**
 * Plans a run.
 *
 * Only a recipe that makes an **inventory item** can be produced. A recipe for
 * a sellable variant has nothing to book into stock — a burger is not a thing
 * the store room holds — and is depleted at sale time instead. Refusing here
 * makes that distinction visible when somebody sets the recipe up, rather than
 * as a confusing failure at completion.
 */
export async function createProductionOrder(data, actor = null) {
  const [location, recipe] = await Promise.all([
    prisma.stockLocation.findUnique({
      where: { id: data.locationId },
      select: {
        id: true,
        name: true,
        isActive: true,
        branchId: true,
        branch: { select: { id: true, code: true, timezone: true } },
      },
    }),
    prisma.recipe.findUnique({
      where: { id: data.recipeId },
      select: {
        id: true,
        name: true,
        isActive: true,
        outputItemId: true,
        yieldQuantity: true,
        yieldUomId: true,
        outputItem: { select: { id: true, name: true, isActive: true } },
      },
    }),
  ]);

  if (!location) throw ApiError.validation("Stock location not found", { locationId: ["No such location"] });
  if (!location.isActive) throw ApiError.conflict("That stock location is not active");
  if (!recipe) throw ApiError.validation("Recipe not found", { recipeId: ["No such recipe"] });

  if (!recipe.outputItemId) {
    throw ApiError.validation(`"${recipe.name}" makes a menu item, not stock`, {
      recipeId: ["Only a recipe that produces an inventory item can be produced in a batch"],
    });
  }
  if (!recipe.isActive) {
    throw ApiError.conflict("That recipe version is no longer active", { recipeId: recipe.id });
  }
  if (!recipe.outputItem?.isActive) {
    throw ApiError.conflict(`${recipe.outputItem?.name ?? "The output item"} is not active`);
  }
  if (D(data.plannedQuantity).lessThanOrEqualTo(0)) {
    throw ApiError.validation("Plan a quantity greater than zero", { plannedQuantity: ["Must be more than zero"] });
  }

  // An estimate at today's prices, so a planned run already shows what it is
  // expected to cost. Re-frozen when the run actually starts.
  const standard = await standardCostForRun({ recipeId: recipe.id, quantity: data.plannedQuantity });

  const run = await withTransaction(async (tx) => {
    const productionNumber = await allocateProductionNumber(tx, { branch: location.branch });

    return tx.productionOrder.create({
      data: {
        productionNumber,
        branchId: location.branchId,
        locationId: location.id,
        recipeId: recipe.id,
        status: "PLANNED",
        plannedQuantity: q(data.plannedQuantity),
        standardCost: standard.totalCost,
        batchNumber: data.batchNumber ?? null,
        expiryDate: data.expiryDate ?? null,
        scheduledFor: data.scheduledFor ?? null,
        supervisorId: data.supervisorId ?? null,
        createdById: actor?.userId ?? null,
        notes: data.notes ?? null,
      },
      select: SELECT,
    });
  });

  await recordAudit({
    actorId: actor?.userId ?? null,
    branchId: location.branchId,
    action: "production_order.create",
    entityType: "ProductionOrder",
    entityId: run.id,
    changes: {
      productionNumber: run.productionNumber,
      recipe: recipe.name,
      plannedQuantity: Number(run.plannedQuantity),
      standardCost: Number(standard.totalCost),
    },
  });

  return { ...run, standard };
}

/** A planned run can still be re-planned; a started one cannot. */
export async function updateProductionOrder(id, data, actor = null) {
  const run = await loadRun(id);

  if (run.status !== "PLANNED") {
    throw ApiError.conflict("Only a planned run can be changed", { status: run.status });
  }

  const replan = data.plannedQuantity != null && !D(data.plannedQuantity).equals(D(run.plannedQuantity));
  const standard = replan
    ? await standardCostForRun({ recipeId: run.recipeId, quantity: data.plannedQuantity })
    : null;

  // Guarded on the status, so a run started a moment ago is not re-planned
  // underneath the material already issued to it.
  return withTransaction(async (tx) => {
    await claimRun(tx, id, {
      from: ["PLANNED"],
      data: {
        ...(data.plannedQuantity != null ? { plannedQuantity: q(data.plannedQuantity) } : {}),
        ...(standard ? { standardCost: standard.totalCost } : {}),
        ...(data.scheduledFor !== undefined ? { scheduledFor: data.scheduledFor } : {}),
        ...(data.supervisorId !== undefined ? { supervisorId: data.supervisorId } : {}),
        ...(data.batchNumber !== undefined ? { batchNumber: data.batchNumber } : {}),
        ...(data.expiryDate !== undefined ? { expiryDate: data.expiryDate } : {}),
        ...(data.notes !== undefined ? { notes: data.notes } : {}),
      },
    });
    return loadRun(id, tx);
  });
}

/** Records consumption rows and their movements. Shared by start and top-up. */
async function issueMaterials(tx, { run, lines, actor, occurredAt }) {
  let materialCost = ZERO;
  const issued = [];

  for (const line of lines) {
    const result = await postMovement(tx, {
      itemId: line.itemId,
      locationId: run.locationId,
      type: "PRODUCTION_OUT",
      quantity: line.quantity,
      referenceType: "PRODUCTION_ORDER",
      referenceId: run.id,
      notes: `Issued to ${run.productionNumber}`,
      performedById: actor?.userId ?? null,
      occurredAt,
      // A run is a decision being taken now, not a fact already recorded. If
      // the flour is not there, the run does not start.
      allowNegative: false,
    });
    if (!result) continue;

    const unitCost = D(result.movement.unitCost);
    const lineCost = D(line.quantity).times(unitCost);
    materialCost = materialCost.plus(lineCost);

    // One consumption per batch drawn, so a cancellation can put each part
    // back on the batch it came from. A single row with no batch would return
    // the stock to the shelf but not to any batch, where FIFO cannot see it.
    const parts = result.batchAllocations.length
      ? result.batchAllocations.map((allocation) => ({
          batchId: allocation.batchId,
          quantity: D(allocation.quantity),
          unitCost: D(allocation.unitCost),
        }))
      : [{ batchId: null, quantity: D(line.quantity), unitCost }];

    for (const [index, part] of parts.entries()) {
      const consumption = await tx.productionConsumption.create({
        data: {
          productionOrderId: run.id,
          itemId: line.itemId,
          batchId: part.batchId,
          // The plan belongs to the item, so it is written once.
          plannedQuantity: index === 0 && line.plannedQuantity != null ? q(line.plannedQuantity) : null,
          quantity: q(part.quantity),
          unitCost: uc(part.unitCost),
          totalCost: tc(part.quantity.times(part.unitCost)),
          consumedAt: occurredAt,
        },
        select: { id: true, itemId: true, quantity: true, unitCost: true, totalCost: true },
      });

      issued.push(consumption);
    }
  }

  return { materialCost: tc(materialCost), issued };
}

/**
 * Starts a run: material leaves the shelf.
 *
 * `items` overrides what is issued. A kitchen that knows it is using the end of
 * yesterday's box rather than the planned quantity should say so — the actual
 * consumption is what the variance is computed from, and a system that only
 * accepts the plan can never show a usage variance at all.
 */
export async function startProduction(id, { items = null, actor }) {
  const run = await loadRun(id);
  assertProductionTransition(run.status, "IN_PROGRESS");
  if (items?.length) await assertIssuable(items);

  const planned = await planConsumption({ recipeId: run.recipeId, quantity: run.plannedQuantity });
  const plannedById = new Map(planned.map((line) => [line.itemId, line]));

  if (!planned.length && !items?.length) {
    throw ApiError.conflict("This recipe has no ingredients, so there is nothing to issue", {
      recipeId: run.recipeId,
    });
  }

  const lines = items?.length
    ? items.map((line) => ({
        itemId: line.itemId,
        quantity: D(line.quantity),
        plannedQuantity: plannedById.get(line.itemId)?.quantity ?? null,
      }))
    : planned.map((line) => ({ ...line, plannedQuantity: line.quantity }));

  const startedAt = new Date();

  // The standard is frozen here, at the moment the run commits, so a price
  // change halfway through the day cannot move the bar the run is judged by.
  const standard = await standardCostForRun({ recipeId: run.recipeId, quantity: run.plannedQuantity });

  const started = await withTransaction(async (tx) => {
    await claimRun(tx, id, { from: ["PLANNED"], to: "IN_PROGRESS", data: { startedAt } });

    const { materialCost } = await issueMaterials(tx, { run, lines, actor, occurredAt: startedAt });

    return tx.productionOrder.update({
      where: { id },
      data: { materialCost, standardCost: standard.totalCost },
      select: SELECT,
    });
  });

  await recordAudit({
    actorId: actor?.userId ?? null,
    branchId: run.branchId,
    action: "production_order.start",
    entityType: "ProductionOrder",
    entityId: id,
    changes: {
      productionNumber: run.productionNumber,
      lines: lines.length,
      materialCost: Number(started.materialCost),
      standardCost: Number(standard.totalCost),
    },
  });

  return { ...started, standard };
}

/**
 * Issues more material to a run already under way.
 *
 * The dough was too dry and took another litre of water. Recorded as its own
 * consumption rather than by editing the first one, so the variance shows what
 * really went in.
 */
export async function recordConsumption(id, { items, actor }) {
  const run = await loadRun(id);

  if (run.status !== "IN_PROGRESS") {
    throw ApiError.conflict("Material can only be issued to a run that is under way", { status: run.status });
  }
  if (!items?.length) {
    throw ApiError.validation("Say what was issued", { items: ["Add at least one line"] });
  }
  await assertIssuable(items);

  const occurredAt = new Date();

  return withTransaction(async (tx) => {
    // Holds the run while the material goes out, so it cannot be completed or
    // cancelled halfway — a completion would miss this cost, a cancellation
    // would not return this stock.
    await claimRun(tx, id, { from: ["IN_PROGRESS"] });

    const { materialCost } = await issueMaterials(tx, {
      run,
      lines: items.map((line) => ({ itemId: line.itemId, quantity: D(line.quantity) })),
      actor,
      occurredAt,
    });

    return tx.productionOrder.update({
      where: { id },
      data: { materialCost: { increment: materialCost } },
      select: SELECT,
    });
  });
}

/**
 * Completes a run: output goes into stock at what it cost.
 *
 * The unit cost is the run's whole cost spread over everything it made, good
 * and wasted alike — because the wasted litres consumed exactly as much flour
 * as the good ones. The good output is booked in at that rate; the wasted
 * output is booked in and immediately written off, so the loss appears as a
 * costed wastage record against this run instead of quietly inflating the cost
 * of what survived.
 */
export async function completeProduction(id, data, actor) {
  const run = await loadRun(id);
  assertProductionTransition(run.status, "COMPLETED");

  const recipe = run.recipe;
  const outputItem = recipe.outputItem;
  if (!outputItem) {
    throw ApiError.conflict("This recipe has no output item, so nothing can be booked into stock");
  }

  const produced = D(data.producedQuantity);
  const wasted = D(data.wastedQuantity ?? 0);

  if (produced.lessThanOrEqualTo(0)) {
    throw ApiError.validation("A completed run has to have produced something", {
      producedQuantity: ["Must be more than zero. Cancel the run instead if it made nothing."],
    });
  }

  // By-products are credited at their own standard cost; the primary output
  // absorbs the rest.
  const byProducts = data.byProducts ?? [];
  const byProductIds = byProducts.map((line) => line.itemId);
  if (new Set(byProductIds).size !== byProductIds.length) {
    throw ApiError.validation("A by-product is listed twice", { byProducts: ["Put each item on one line"] });
  }
  if (byProductIds.includes(outputItem.id)) {
    throw ApiError.validation(`${outputItem.name} is what this run makes, not a by-product`, {
      byProducts: ["Count it in the produced quantity instead"],
    });
  }
  const byProductItems = byProducts.length
    ? await prisma.inventoryItem.findMany({
        where: { id: { in: byProductIds } },
        select: { id: true, name: true, averageCost: true, uomId: true, trackBatches: true, isPerishable: true, shelfLifeDays: true, isActive: true },
      })
    : [];
  const byProductById = new Map(byProductItems.map((item) => [item.id, item]));

  for (const line of byProducts) {
    const item = byProductById.get(line.itemId);
    if (!item) throw ApiError.validation("By-product item not found", { byProducts: [`No such item: ${line.itemId}`] });
    if (!item.isActive) throw ApiError.validation(`${item.name} is switched off`, { byProducts: [`Switch ${item.name} back on first`] });
  }

  const batchNumber = data.batchNumber?.trim() || run.batchNumber || run.productionNumber;
  if (outputItem.trackBatches) {
    const taken = await prisma.stockBatch.findUnique({
      where: { itemId_locationId_batchNumber: { itemId: outputItem.id, locationId: run.locationId, batchNumber } },
      select: { id: true },
    });
    if (taken) {
      throw ApiError.conflict(`${outputItem.name} already has a batch ${batchNumber} here`, {
        batchNumber: [`Give this run's batch its own number`],
      });
    }
  }

  const completedAt = new Date();

  const completed = await withTransaction(async (tx) => {
    // Claimed first, then the cost read: material issued a moment before this
    // is part of the run, and a cost read before the claim would leave it out.
    await claimRun(tx, id, { from: ["IN_PROGRESS"], to: "COMPLETED", data: { completedAt } });
    const { materialCost } = await tx.productionOrder.findUnique({ where: { id }, select: { materialCost: true } });

    // Labour and overhead come from the recipe, scaled to what was actually
    // made, unless the caller knows better. A run that made half a batch did
    // not use a full batch's labour.
    const scale = D(recipe.yieldQuantity).greaterThan(0)
      ? produced.plus(wasted).dividedBy(D(recipe.yieldQuantity))
      : D(1);

    const laborCost = data.laborCost != null ? tc(data.laborCost) : tc(D(recipe.laborCost).times(scale));
    const overheadCost = data.overheadCost != null ? tc(data.overheadCost) : tc(D(recipe.overheadCost).times(scale));
    const totalCost = tc(D(materialCost).plus(D(laborCost)).plus(D(overheadCost)));

    // Everything the run made, good and wasted, carries an equal share.
    const madeQuantity = produced.plus(wasted);
    const rate = madeQuantity.greaterThan(0) ? D(totalCost).dividedBy(madeQuantity) : ZERO;

    const allocation = allocateOutputCosts({
      totalCost,
      outputs: [
        { itemId: outputItem.id, quantity: madeQuantity, isPrimary: true },
        ...byProducts.map((line) => ({
          itemId: line.itemId,
          quantity: D(line.quantity),
          isPrimary: false,
          standardUnitCost: line.unitCost ?? byProductById.get(line.itemId)?.averageCost ?? 0,
        })),
      ],
    });

    const primary = allocation.find((output) => output.isPrimary);

    // Recipe yield unit into the item's stocking unit — a recipe yielding
    // "litres" of an item stocked in millilitres must book 1000, not 1.
    const producedInStock = convertQuantity({
      quantity: produced,
      from: recipe.yieldUom,
      to: outputItem.uom,
    });
    const wastedInStock = convertQuantity({
      quantity: wasted,
      from: recipe.yieldUom,
      to: outputItem.uom,
    });
    const stockRate = producedInStock.plus(wastedInStock).greaterThan(0)
      ? D(primary.totalCost).dividedBy(producedInStock.plus(wastedInStock))
      : ZERO;

    let batchId = null;

    if (outputItem.trackBatches) {
      const expiryDate =
        data.expiryDate ??
        run.expiryDate ??
        (outputItem.isPerishable && outputItem.shelfLifeDays
          ? new Date(completedAt.getTime() + outputItem.shelfLifeDays * 86_400_000)
          : null);

      // Its own batch, never merged into one of the same number: a batch has
      // one cost and one date, and folding this run into last week's would
      // give today's food last week's expiry.
      const batch = await tx.stockBatch.create({
        data: {
          itemId: outputItem.id,
          locationId: run.locationId,
          batchNumber,
          initialQuantity: q(producedInStock.plus(wastedInStock)),
          remainingQuantity: q(producedInStock.plus(wastedInStock)),
          unitCost: uc(stockRate),
          status: "ACTIVE",
          manufacturedAt: completedAt,
          expiryDate,
          receivedAt: completedAt,
          productionOrderId: run.id,
        },
        select: { id: true },
      });

      batchId = batch.id;
    }

    // Everything made goes in, including what will immediately be binned — the
    // ledger should show that it existed and then did not.
    await postMovement(tx, {
      itemId: outputItem.id,
      locationId: run.locationId,
      type: "PRODUCTION_IN",
      quantity: producedInStock.plus(wastedInStock),
      uomId: outputItem.uomId,
      unitCost: uc(stockRate),
      batchId,
      referenceType: "PRODUCTION_ORDER",
      referenceId: run.id,
      notes: `Produced on ${run.productionNumber}`,
      performedById: actor?.userId ?? null,
      occurredAt: completedAt,
    });

    await tx.productionOutput.create({
      data: {
        productionOrderId: run.id,
        itemId: outputItem.id,
        batchId,
        quantity: q(producedInStock),
        unitCost: uc(stockRate),
        totalCost: tc(producedInStock.times(stockRate)),
        isPrimary: true,
        producedAt: completedAt,
      },
    });

    // --- by-products ------------------------------------------------------
    for (const output of allocation.filter((row) => !row.isPrimary)) {
      const item = byProductById.get(output.itemId);

      // A batch-tracked by-product needs a batch like any other stock, or FIFO
      // never sees it.
      let byProductBatchId = null;
      if (item.trackBatches) {
        const byProductBatch = await tx.stockBatch.upsert({
          where: {
            itemId_locationId_batchNumber: { itemId: item.id, locationId: run.locationId, batchNumber: run.productionNumber },
          },
          create: {
            itemId: item.id,
            locationId: run.locationId,
            batchNumber: run.productionNumber,
            initialQuantity: q(output.quantity),
            remainingQuantity: q(output.quantity),
            unitCost: output.unitCost,
            status: "ACTIVE",
            manufacturedAt: completedAt,
            expiryDate:
              item.isPerishable && item.shelfLifeDays
                ? new Date(completedAt.getTime() + item.shelfLifeDays * 86_400_000)
                : null,
            receivedAt: completedAt,
            productionOrderId: run.id,
          },
          // The run number is this run's own, so a clash can only be this
          // same completion retried; nothing to add twice.
          update: {},
          select: { id: true },
        });
        byProductBatchId = byProductBatch.id;
      }

      await postMovement(tx, {
        itemId: output.itemId,
        locationId: run.locationId,
        type: "PRODUCTION_IN",
        quantity: output.quantity,
        uomId: item.uomId,
        unitCost: output.unitCost,
        batchId: byProductBatchId,
        referenceType: "PRODUCTION_ORDER",
        referenceId: run.id,
        notes: `By-product of ${run.productionNumber}`,
        performedById: actor?.userId ?? null,
        occurredAt: completedAt,
      });

      await tx.productionOutput.create({
        data: {
          productionOrderId: run.id,
          itemId: output.itemId,
          batchId: byProductBatchId,
          quantity: q(output.quantity),
          unitCost: output.unitCost,
          totalCost: output.totalCost,
          isPrimary: false,
          producedAt: completedAt,
        },
      });
    }

    // --- yield loss -------------------------------------------------------
    if (wastedInStock.greaterThan(0)) {
      await postMovement(tx, {
        itemId: outputItem.id,
        locationId: run.locationId,
        type: "WASTAGE",
        quantity: wastedInStock,
        uomId: outputItem.uomId,
        unitCost: uc(stockRate),
        batchId,
        referenceType: "PRODUCTION_ORDER",
        referenceId: run.id,
        notes: `Yield loss on ${run.productionNumber}`,
        performedById: actor?.userId ?? null,
        occurredAt: completedAt,
      });

      await tx.wastage.create({
        data: {
          itemId: outputItem.id,
          locationId: run.locationId,
          productionOrderId: run.id,
          quantity: q(wastedInStock),
          unitCost: uc(stockRate),
          totalCost: tc(wastedInStock.times(stockRate)),
          reason: data.wastageReason ?? "PRODUCTION_LOSS",
          notes: data.wastageNotes ?? `Yield loss on ${run.productionNumber}`,
          recordedById: actor?.userId ?? null,
          occurredAt: completedAt,
        },
      });
    }

    await enqueue({
      eventType: "finance.production_completed",
      payload: { productionOrderId: id },
      db: tx,
    });

    return tx.productionOrder.update({
      where: { id },
      data: {
        producedQuantity: q(produced),
        wastedQuantity: q(wasted),
        laborCost,
        overheadCost,
        totalCost,
        unitCost: uc(rate),
        ...(outputItem.trackBatches ? { batchNumber } : {}),
        ...(data.notes !== undefined ? { notes: data.notes } : {}),
      },
      select: SELECT,
    });
  });

  const result = summariseRun(completed);

  await recordAudit({
    actorId: actor?.userId ?? null,
    branchId: run.branchId,
    action: "production_order.complete",
    entityType: "ProductionOrder",
    entityId: id,
    changes: {
      productionNumber: run.productionNumber,
      producedQuantity: Number(produced),
      wastedQuantity: Number(wasted),
      totalCost: Number(completed.totalCost),
      standardCost: Number(run.standardCost ?? 0),
      variance: Number(result.costVariance.variance),
    },
  });

  return result;
}

/**
 * Cancels a run.
 *
 * A planned run simply stops. A run under way has material on the bench that
 * belongs back on the shelf, so every consumption is reversed at the cost it
 * left at, and back onto its own batch where one was recorded. Reversed rather
 * than deleted: the ledger is append-only, and material that was issued and
 * returned is two facts, not none.
 */
export async function cancelProduction(id, { reason = null, actor }) {
  const run = await loadRun(id);
  assertProductionTransition(run.status, "CANCELLED");

  const occurredAt = new Date();
  let reversed = 0;

  const cancelled = await withTransaction(async (tx) => {
    await claimRun(tx, id, { from: ["PLANNED", "IN_PROGRESS"], to: "CANCELLED" });

    // Read after the claim: material issued while this request was on its way
    // is on the bench too, and has to come back with the rest.
    const consumptions = await tx.productionConsumption.findMany({
      where: { productionOrderId: id },
      select: { id: true, itemId: true, batchId: true, quantity: true, unitCost: true },
    });
    reversed = consumptions.length;

    for (const consumption of consumptions) {
      await postMovement(tx, {
        itemId: consumption.itemId,
        locationId: run.locationId,
        type: "PRODUCTION_IN",
        quantity: D(consumption.quantity).abs(),
        unitCost: consumption.unitCost,
        batchId: consumption.batchId,
        restoreBatch: Boolean(consumption.batchId),
        referenceType: "PRODUCTION_CANCELLED",
        referenceId: run.id,
        notes: `Returned from cancelled ${run.productionNumber}`,
        performedById: actor?.userId ?? null,
        occurredAt,
      });
    }

    return tx.productionOrder.update({
      where: { id },
      data: {
        materialCost: 0,
        totalCost: 0,
        notes: reason ?? run.notes,
      },
      select: SELECT,
    });
  });

  await recordAudit({
    actorId: actor?.userId ?? null,
    branchId: run.branchId,
    action: "production_order.cancel",
    entityType: "ProductionOrder",
    entityId: id,
    changes: { productionNumber: run.productionNumber, reason, reversed },
  });

  return cancelled;
}

/** Actual against standard, for one run. */
export function summariseRun(run) {
  const costVariance = variance({
    standard: run.standardCost ?? 0,
    actual: run.totalCost ?? 0,
  });

  const yields = yieldVariance({
    planned: run.plannedQuantity,
    produced: run.producedQuantity,
    wasted: run.wastedQuantity,
  });

  return { ...run, costVariance, yieldVariance: yields };
}

export async function getProductionOrder(id) {
  const run = await loadRun(id);

  // What the recipe said it would take, next to what it actually took.
  const planned = await planConsumption({ recipeId: run.recipeId, quantity: run.plannedQuantity });
  const consumedByItem = new Map();
  for (const row of run.consumptions) {
    const existing = consumedByItem.get(row.itemId) ?? { quantity: ZERO, totalCost: ZERO };
    existing.quantity = existing.quantity.plus(D(row.quantity));
    existing.totalCost = existing.totalCost.plus(D(row.totalCost));
    // Weighted over every draw: one item may come off several batches, or be
    // topped up later at a different cost.
    existing.unitCost = existing.quantity.greaterThan(0) ? existing.totalCost.dividedBy(existing.quantity) : ZERO;
    consumedByItem.set(row.itemId, existing);
  }

  const materials = planned.map((line) => {
    const actual = consumedByItem.get(line.itemId);

    return {
      itemId: line.itemId,
      name: line.name,
      sku: line.sku,
      plannedQuantity: q(line.quantity),
      actualQuantity: q(actual?.quantity ?? 0),
      unitCost: uc(actual?.unitCost ?? 0),
      usageVariance: q(D(actual?.quantity ?? 0).minus(D(line.quantity))),
    };
  });

  // Anything issued that the recipe never called for.
  for (const [itemId, actual] of consumedByItem) {
    if (planned.some((line) => line.itemId === itemId)) continue;
    const row = run.consumptions.find((line) => line.itemId === itemId);

    materials.push({
      itemId,
      name: row?.item?.name ?? null,
      sku: row?.item?.sku ?? null,
      plannedQuantity: q(0),
      actualQuantity: q(actual.quantity),
      unitCost: uc(actual.unitCost),
      usageVariance: q(actual.quantity),
      unplanned: true,
    });
  }

  // What is on the shelf at the run's location now, so a planned run shows
  // what it will be short of before anyone presses Start.
  const levels = materials.length
    ? await prisma.stockLevel.findMany({
        where: { locationId: run.locationId, itemId: { in: materials.map((line) => line.itemId) } },
        select: { itemId: true, quantity: true },
      })
    : [];
  const onHandById = new Map(levels.map((level) => [level.itemId, level.quantity]));
  for (const line of materials) line.onHand = q(onHandById.get(line.itemId) ?? 0);

  return { ...summariseRun(run), materials };
}

const RUN_COST_FIELDS = ["materialCost", "laborCost", "overheadCost", "totalCost", "unitCost", "standardCost", "costVariance", "standard"];

/**
 * A run with its money taken out, for someone who may run the kitchen but not
 * read its costs. Quantities, batches and dates stay: they are the work.
 */
export function withoutRunCosts(run) {
  if (!run) return run;
  const stripped = { ...run };
  for (const field of RUN_COST_FIELDS) delete stripped[field];
  if (stripped.recipe) {
    const { laborCost, overheadCost, ...recipe } = stripped.recipe;
    stripped.recipe = recipe;
  }
  const lines = (rows) => rows?.map(({ unitCost, totalCost, ...row }) => row);
  if (stripped.consumptions) stripped.consumptions = lines(stripped.consumptions);
  if (stripped.outputs) stripped.outputs = lines(stripped.outputs);
  if (stripped.materials) stripped.materials = lines(stripped.materials);
  return stripped;
}

/** How many runs are in each state, for the tabs. */
export async function productionCounts({ scope = null, branchId = null } = {}) {
  const filter = branchFilter(scope);
  const rows = await prisma.productionOrder.groupBy({
    by: ["status"],
    where: {
      ...(branchId ? { branchId } : {}),
      ...(filter ? { AND: [{ branchId: filter }] } : {}),
    },
    _count: { _all: true },
  });
  return Object.fromEntries(rows.map((row) => [row.status, row._count._all]));
}

export async function listProductionOrders({
  branchId,
  locationId,
  recipeId,
  status,
  from,
  to,
  scope = null,
  limit = 20,
  cursor,
} = {}) {
  const filter = branchFilter(scope);
  const rows = await prisma.productionOrder.findMany({
    where: {
      ...(branchId ? { branchId } : {}),
      ...(filter ? { AND: [{ branchId: filter }] } : {}),
      ...(locationId ? { locationId } : {}),
      ...(recipeId ? { recipeId } : {}),
      ...(status ? { status } : {}),
      ...(from || to
        ? { createdAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } }
        : {}),
    },
    select: {
      id: true,
      productionNumber: true,
      branchId: true,
      status: true,
      plannedQuantity: true,
      producedQuantity: true,
      wastedQuantity: true,
      totalCost: true,
      standardCost: true,
      unitCost: true,
      scheduledFor: true,
      startedAt: true,
      completedAt: true,
      createdAt: true,
      createdById: true,
      recipe: {
        select: {
          id: true,
          name: true,
          version: true,
          yieldUom: { select: { code: true, precision: true } },
          outputItem: { select: { id: true, name: true } },
        },
      },
      location: { select: { id: true, name: true, branch: { select: { id: true, name: true } } } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    ...cursorArgs(cursor, limit),
  });

  const page = toPage(rows, limit);
  return {
    ...page,
    items: page.items.map((row) => ({
      ...row,
      costVariance: variance({ standard: row.standardCost ?? 0, actual: row.totalCost ?? 0 }),
    })),
  };
}

/**
 * Production variance across a period.
 *
 * The management report: what the kitchen was supposed to spend making things
 * against what it did spend, and how much of what it started came out usable.
 * Only completed runs are counted — a run still on the bench has a real
 * material cost and no output yet, and including it would make every period
 * look catastrophic until the last batch finished.
 */
export async function productionVarianceReport({ branchId, from, to, recipeId = null, scope = null } = {}) {
  const filter = branchFilter(scope);
  const runs = await prisma.productionOrder.findMany({
    where: {
      ...(branchId ? { branchId } : {}),
      ...(filter ? { AND: [{ branchId: filter }] } : {}),
      ...(recipeId ? { recipeId } : {}),
      status: "COMPLETED",
      ...(from || to
        ? { completedAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } }
        : {}),
    },
    select: {
      id: true,
      productionNumber: true,
      recipeId: true,
      plannedQuantity: true,
      producedQuantity: true,
      wastedQuantity: true,
      materialCost: true,
      laborCost: true,
      overheadCost: true,
      totalCost: true,
      standardCost: true,
      unitCost: true,
      completedAt: true,
      recipe: { select: { id: true, name: true, version: true } },
    },
    orderBy: { completedAt: "desc" },
  });

  const byRecipe = new Map();

  const rows = runs.map((run) => {
    const summary = {
      id: run.id,
      productionNumber: run.productionNumber,
      recipe: run.recipe,
      completedAt: run.completedAt,
      plannedQuantity: run.plannedQuantity,
      producedQuantity: run.producedQuantity,
      wastedQuantity: run.wastedQuantity,
      materialCost: run.materialCost,
      laborCost: run.laborCost,
      overheadCost: run.overheadCost,
      unitCost: run.unitCost,
      costVariance: variance({ standard: run.standardCost ?? 0, actual: run.totalCost ?? 0 }),
      yieldVariance: yieldVariance({
        planned: run.plannedQuantity,
        produced: run.producedQuantity,
        wasted: run.wastedQuantity,
      }),
    };

    const key = run.recipeId;
    const bucket = byRecipe.get(key) ?? {
      recipe: run.recipe,
      runs: 0,
      standardCost: ZERO,
      actualCost: ZERO,
      producedQuantity: ZERO,
      wastedQuantity: ZERO,
    };

    bucket.runs += 1;
    bucket.standardCost = bucket.standardCost.plus(D(run.standardCost));
    bucket.actualCost = bucket.actualCost.plus(D(run.totalCost));
    bucket.producedQuantity = bucket.producedQuantity.plus(D(run.producedQuantity));
    bucket.wastedQuantity = bucket.wastedQuantity.plus(D(run.wastedQuantity));
    byRecipe.set(key, bucket);

    return summary;
  });

  const summary = [...byRecipe.values()]
    .map((bucket) => ({
      recipe: bucket.recipe,
      runs: bucket.runs,
      producedQuantity: q(bucket.producedQuantity),
      wastedQuantity: q(bucket.wastedQuantity),
      wastePercent: bucket.producedQuantity.plus(bucket.wastedQuantity).greaterThan(0)
        ? Number(
            bucket.wastedQuantity
              .dividedBy(bucket.producedQuantity.plus(bucket.wastedQuantity))
              .times(100)
              .toDecimalPlaces(2),
          )
        : 0,
      ...variance({ standard: bucket.standardCost, actual: bucket.actualCost }),
    }))
    // Biggest overspend first — the list is read to find what to look at.
    .sort((a, b) => Number(D(b.variance).minus(D(a.variance))));

  return { runs: rows, summary };
}
