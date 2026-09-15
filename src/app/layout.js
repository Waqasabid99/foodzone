import { Montserrat, Chivo } from "next/font/google";
import "react-toastify/dist/ReactToastify.css";
import "./globals.css";
import ThemeScript from "@/components/theme/ThemeScript";
import ToastProvider from "@/components/layout/ToastProvider";

const montserrat = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin"],
  weight: ["700", "800", "900"],
});

const chivo = Chivo({
  variable: "--font-chivo",
  subsets: ["latin"],
  weight: ["400", "700"],
});

export const metadata = {
  title: "FoodZone | Fast Food Delivered Fast",
  description: "Order burgers, pizza, fries and more from FoodZone.",
};

/**
 * The document shell, and nothing else.
 *
 * Deliberately carries no navigation. The storefront, the staff dashboard and
 * a customer's account area are three different products sharing one design
 * system, and each brings its own chrome from its route group — `(site)` the
 * public header and footer, `(dashboard)` and `(account)` a sidebar. Putting
 * any of that here would force every other section to undo it.
 *
 * What does belong here is what the whole document needs: fonts, the theme
 * attribute, the stylesheet and one toast host.
 */
export default function RootLayout({ children }) {
  return (
    // `data-theme` is the light default for SSR; ThemeScript rewrites it before
    // the first paint when the visitor has chosen dark. React is told to expect
    // that attribute to differ, since the script runs before hydration.
    <html
      lang="en"
      data-theme="light"
      suppressHydrationWarning
      className={`${montserrat.variable} ${chivo.variable} h-full antialiased`}
    >
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-full bg-surface text-on-surface">
        {children}
        <ToastProvider />
      </body>
    </html>
  );
}
