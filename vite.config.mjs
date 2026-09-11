// Keep implementation notes in source without sending them in the app shell.
// Conditional HTML comments, if introduced, retain their browser semantics.
export default {
  plugins: [{
    name: 'omit-production-html-notes',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: html => html.replace(/<!--(?!\[if)[\s\S]*?-->/g, ''),
    },
  }],
};
