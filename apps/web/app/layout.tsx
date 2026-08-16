export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <title>AI Learning OS | Learn with direction</title>
        <meta name="description" content="An adaptive learning workspace that turns every answer, mistake, and moment of doubt into a clear next step." />
        <meta name="theme-color" content="#16213d" />
      </head>
      <body>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
import './globals.css';
import { SessionProvider } from '../lib/session';
