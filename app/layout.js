import "./globals.css";

export const metadata = { title: "Resume Ranker", description: "Rank resumes against LCA and UI/UX roles" };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
