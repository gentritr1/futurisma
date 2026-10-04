// Keep implementation notes in source without sending them in the app shell.
// Conditional HTML comments, if introduced, retain their browser semantics.
const omitProductionHtmlNotes = {
  name: 'omit-production-html-notes',
  apply: 'build',
  transformIndexHtml: {
    order: 'post',
    handler: html => html.replace(/<!--(?!\[if)[\s\S]*?-->/g, ''),
  },
};

const PHONE_PORT = 5173;

export default async ({ mode }) => {
  if (mode !== 'phone') return { plugins: [omitProductionHtmlNotes] };

  // `npm run dev:phone` only: HTTPS on the Wi-Fi address plus the controller
  // relay. The module (and its qrcode dev dependency) is never loaded otherwise.
  const { ensureDevCertificate, lanAddress, phoneControllerPlugin } =
    await import('./scripts/phone-controller-server.mjs');
  const lan = lanAddress();
  return {
    plugins: [omitProductionHtmlNotes, phoneControllerPlugin({ lan, port: PHONE_PORT })],
    server: {
      // The Wi-Fi interface only, not every interface: VPN and tethering stay closed.
      host: lan ?? '127.0.0.1',
      port: PHONE_PORT,
      strictPort: true,
      https: ensureDevCertificate('.cert', lan),
      // Setting `deny` replaces Vite's default list, so the defaults are repeated
      // before the dev certificate's own directory.
      fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.cert/**'] },
    },
  };
};
