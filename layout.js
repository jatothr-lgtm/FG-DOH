import "./globals.css";

export const metadata = {
  title: "FG DOH Dashboard",
  description: "Finished Goods Days on Hand Dashboard",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
