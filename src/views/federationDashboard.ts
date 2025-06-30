export function renderFederationDashboard({ stats, recentActivity, federatedPosts, loggedInUser, domain }) {
  return `
    <html>
      <head><title>Federation Dashboard</title></head>
      <body>
        <h1>Federation Dashboard</h1>
        <h2>Stats</h2>
        <pre>${JSON.stringify(stats, null, 2)}</pre>
        <h2>Recent Activity</h2>
        <pre>${JSON.stringify(recentActivity, null, 2)}</pre>
        <h2>Federated Posts</h2>
        <pre>${JSON.stringify(federatedPosts, null, 2)}</pre>
        <p>User: ${loggedInUser?.username || ''}</p>
        <p>Domain: ${domain}</p>
        <a href="/">Back to home</a>
      </body>
    </html>
  `;
}
