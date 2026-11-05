/**
 * The public pages whose words the owner edits.
 *
 * Seeded rather than created through the API, because a slug is half of a
 * route: a page invented at runtime is a page that 404s on a typo nobody can
 * see. Adding one is a code change and a seed entry, which is the same amount
 * of ceremony as the route it needs anyway.
 *
 * The bodies below are **starting drafts, not legal advice**. They are written
 * as something a restaurant owner can edit a line at a time rather than as
 * lorem ipsum, because a placeholder page that reads like a placeholder is one
 * nobody ever gets around to replacing — but the legal ones in particular
 * should be read by somebody qualified before they are relied on.
 *
 * Re-running the seed **never overwrites an edited body.** Only a page that is
 * still exactly as seeded is updated, so improving the drafts here reaches the
 * installations that never touched them and leaves everyone else alone.
 */
export const CONTENT_PAGES = [
  {
    slug: "about",
    title: "About Us",
    summary: "Who we are and how we cook.",
    body: `We cook the food we would want to eat, and we would rather do a short menu properly than a long one badly.

## How we cook
Everything is made to order. Nothing sits under a heat lamp waiting for somebody to want it, which is why a busy evening takes a few minutes longer than a quiet one.

## Where we are
Our branches and their opening hours are listed at the bottom of every page. Each kitchen runs its own menu, so what is available can differ between them.

## Talk to us
If something was not right, we would genuinely rather hear it than not. The contact page has the quickest ways to reach us.`,
  },
  {
    slug: "contact",
    title: "Contact Us",
    summary: "How to reach us about an order, a question or a complaint.",
    body: `## About an order
If it is about an order you have already placed, have the order number ready — it is on your confirmation and in your account under Orders. That is the single fastest way for us to find you.

## Opening hours
Each branch keeps its own hours, and they are listed at the bottom of every page. We answer messages during opening hours; anything sent overnight is picked up the next morning.

## If something went wrong
Tell us what you ordered, which branch it came from, and what happened. We would rather fix it than debate it.

## Everything else
For press, partnerships or anything that is not about an order, use the same address and say so in the first line.`,
  },
  {
    slug: "careers",
    title: "Careers",
    summary: "Working in our kitchens and on the road.",
    body: `Most of the people here started on a station or on a bike. We would rather train somebody who turns up than hire somebody who already knows everything.

## Kitchen
Line cooks, prep and chefs. Hours are shift-based and the busy ones are evenings and weekends, which is the honest version of working in food. Experience helps and is not required for prep.

## Front of house
Counter, order packing and dine-in service. The job is mostly judgement under time pressure, so we care more about how you handle a queue than what is on your CV.

## Delivery
Riders work set shifts from one branch. You will need your own licence and the right to work here; we handle the rest.

## How to apply
Use the contact page, say which branch and which job, and tell us when you can start. Tell us about any experience you have — and if you have none, say that instead of inventing some.

We reply to everyone, including when the answer is no.`,
  },
  {
    slug: "terms",
    title: "Terms & Conditions",
    summary: "The terms you agree to when you order from us.",
    body: `These terms apply when you place an order with us, whether through this website or our app.

## Orders
An order is accepted when the branch confirms it, not when you press the button. If we cannot accept an order — an item has sold out, or the kitchen is at capacity — we will tell you and you will not be charged.

## Prices
Prices are shown including tax unless stated otherwise, and can differ between branches. The price you pay is the one shown at checkout.

## Cancelling
You can cancel while an order is still waiting to be confirmed. Once the kitchen has started cooking, we cannot cancel it, because the food has already been made.

## If something is wrong
Contact us the same day with your order number. Where we have got it wrong we will put it right.

## Changes
We may update these terms. The version on this page is the one that applies.`,
  },
  {
    slug: "privacy",
    title: "Privacy Policy",
    summary: "What we collect, why, and what you can ask us to do with it.",
    body: `This policy explains what we do with your information when you order from us.

## What we collect
Your name, contact details and delivery address, the orders you place, and — if you have an account — the devices you are signed in on. Payments are handled by our payment provider; we do not store your card number.

## Why we collect it
To cook and deliver what you ordered, to take payment, to answer you when something goes wrong, and to meet our tax and accounting obligations.

## Who sees it
The branch cooking your order, our delivery riders, and our payment provider. We do not sell your information.

## How long we keep it
Order records are kept as long as tax law requires. You can ask us to delete your account, and we will remove everything we are not required to keep.

## Your choices
You can ask for a copy of what we hold, ask us to correct it, or ask us to delete it. Marketing messages are opt-in and every one of them has an unsubscribe link.`,
  },
  {
    slug: "terms-of-use",
    title: "Terms of Use",
    summary: "The rules for using this website and our app.",
    body: `These cover using the site itself. The terms that cover ordering are on the Terms & Conditions page.

## Your account
Keep your password to yourself and tell us if you think somebody else has it. You are responsible for what is done through your account.

## Acceptable use
Do not attempt to break, overload or probe the site, and do not use it to post anything unlawful or abusive.

## Customer videos
If you film something you ordered and submit it to us, you keep it — you are giving us permission to show it on the page for the item you filmed, at the branch you bought it from. You can withdraw a video at any time. Do not submit anything you did not film yourself, or anything with other people in it who have not agreed to be there.

## Content on this site
The photographs, text and branding here are ours. The menu and prices are kept as accurate as we can, but a page can be out of date between a change and a cache expiring.

## Availability
We do not promise the site is always up. Scheduled work usually happens overnight.`,
  },
];
