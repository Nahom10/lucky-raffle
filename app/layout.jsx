import './globals.css';

export const metadata = { title: 'Lucky Raffle', description: 'A transparent Telegram raffle Mini App.' };
export default function Layout({ children }) {
  return <html lang="en"><head><script src="https://telegram.org/js/telegram-web-app.js" defer /></head><body>{children}</body></html>;
}
