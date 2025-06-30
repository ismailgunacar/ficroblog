export function renderHome({ user }) {
  return `
    <html>
      <head><title>Home</title></head>
      <body>
        <h1>Welcome${user ? ', ' + user.username : ''}!</h1>
        <a href="/">Home</a>
      </body>
    </html>
  `;
}
