import './globals.css';
import './luxe.css';
import Script from 'next/script';

export const metadata = { title: 'Lucky Raffle', description: 'A transparent Telegram raffle Mini App.' };
export default function Layout({ children }) {
  return <html lang="en"><head><Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" /></head><body>{children}</body></html>;
}
