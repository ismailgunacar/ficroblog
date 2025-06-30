export function renderPostPermalink({ post }) {
  return `
    <html>
      <head><title>Post by ${post.user?.username || 'Unknown'}</title></head>
      <body>
        <h1>Post</h1>
        <p>${post.content}</p>
        <p>By: ${post.user?.username || 'Unknown'}</p>
        <a href="/">Back to home</a>
      </body>
    </html>
  `;
}
