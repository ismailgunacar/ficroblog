interface FederationDashboardProps {
  stats: {
    totalLikes: number;
    totalAnnounces: number;
    totalPosts: number;
    totalUsers: number;
  };
  recentActivity: Array<{
    type: 'like' | 'announce';
    actorId: string;
    actorUsername?: string;
    actorDisplayName?: string;
    objectId: string;
    createdAt: Date;
  }>;
  federatedPosts: any[];
  loggedInUser: { username: string };
  domain: string;
}

export function renderFederationDashboard(props: FederationDashboardProps) {
  const { stats, recentActivity, federatedPosts, loggedInUser, domain } = props;

  return `
    <html>
      <head>
        <title>Federation Dashboard</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
      </head>
      <body>
    <div class="federation-dashboard">
      <div class="dashboard-header">
        <h1>Federation Dashboard</h1>
        <p>Monitor ActivityPub federation activity for ${domain}</p>
      </div>

      <div class="stats-grid">
        <div class="stat-card">
          <h3>Total Posts</h3>
          <div class="stat-number">${stats.totalPosts}</div>
        </div>
        <div class="stat-card">
          <h3>Total Users</h3>
          <div class="stat-number">${stats.totalUsers}</div>
        </div>
        <div class="stat-card">
          <h3>Total Likes</h3>
          <div class="stat-number">${stats.totalLikes}</div>
        </div>
        <div class="stat-card">
          <h3>Total Announces</h3>
          <div class="stat-number">${stats.totalAnnounces}</div>
        </div>
      </div>

      <div class="activity-section">
        <h2>Recent Federation Activity</h2>
        <div class="activity-list">
          ${recentActivity.length > 0 ? recentActivity.map(activity => `
            <div class="activity-item">
              <div class="activity-type ${activity.type}">
                ${activity.type === 'like' ? '❤️' : '🔄'}
              </div>
              <div class="activity-details">
                <div class="activity-actor">
                  <strong>${activity.actorDisplayName || activity.actorUsername || 'Unknown User'}</strong>
                  <span class="actor-id">${activity.actorId}</span>
                </div>
                <div class="activity-action">
                  ${activity.type === 'like' ? 'liked' : 'announced'} a post
                </div>
                <div class="activity-object">
                  <a href="${activity.objectId}" target="_blank">${activity.objectId}</a>
                </div>
                <div class="activity-time">
                  ${activity.createdAt.toLocaleString()}
                </div>
              </div>
            </div>
          `).join('') : '<p>No recent federation activity</p>'}
        </div>
      </div>

      <div class="federation-info">
        <h2>Federation Endpoints</h2>
        <div class="endpoint-list">
          <div class="endpoint-item">
            <strong>Like Inbox:</strong> 
            <code>POST /federation/inbox/like</code>
          </div>
          <div class="endpoint-item">
            <strong>Announce Inbox:</strong> 
            <code>POST /federation/inbox/announce</code>
          </div>
          <div class="endpoint-item">
            <strong>Undo Inbox:</strong> 
            <code>POST /federation/inbox/undo</code>
          </div>
        </div>
      </div>

      <div style="margin-top: 40px;">
        <a href="/" style="color: #007bff; text-decoration: none;">← Back to Home</a>
      </div>
    </div>

    <style>
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        margin: 0;
        padding: 0;
        background-color: #f8f9fa;
      }

      .federation-dashboard {
        max-width: 1200px;
        margin: 0 auto;
        padding: 20px;
      }

      .dashboard-header {
        text-align: center;
        margin-bottom: 30px;
      }

      .dashboard-header h1 {
        color: #333;
        margin-bottom: 10px;
      }

      .dashboard-header p {
        color: #666;
        font-size: 16px;
      }

      .stats-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 20px;
        margin-bottom: 40px;
      }

      .stat-card {
        background: #fff;
        border: 1px solid #e9ecef;
        border-radius: 8px;
        padding: 20px;
        text-align: center;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      }

      .stat-card h3 {
        margin: 0 0 10px 0;
        color: #495057;
        font-size: 14px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .stat-number {
        font-size: 32px;
        font-weight: bold;
        color: #007bff;
      }

      .activity-section {
        margin-bottom: 40px;
      }

      .activity-section h2 {
        color: #333;
        margin-bottom: 20px;
      }

      .activity-list {
        background: #fff;
        border: 1px solid #e9ecef;
        border-radius: 8px;
        overflow: hidden;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      }

      .activity-item {
        display: flex;
        align-items: flex-start;
        padding: 15px;
        border-bottom: 1px solid #e9ecef;
      }

      .activity-item:last-child {
        border-bottom: none;
      }

      .activity-type {
        width: 40px;
        height: 40px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        margin-right: 15px;
        font-size: 18px;
      }

      .activity-type.like {
        background: #ffe6e6;
      }

      .activity-type.announce {
        background: #e6f3ff;
      }

      .activity-details {
        flex: 1;
      }

      .activity-actor {
        margin-bottom: 5px;
      }

      .actor-id {
        color: #666;
        font-size: 12px;
        margin-left: 10px;
      }

      .activity-action {
        color: #666;
        margin-bottom: 5px;
      }

      .activity-object {
        margin-bottom: 5px;
      }

      .activity-object a {
        color: #007bff;
        text-decoration: none;
        font-size: 14px;
      }

      .activity-object a:hover {
        text-decoration: underline;
      }

      .activity-time {
        color: #999;
        font-size: 12px;
      }

      .federation-info {
        margin-bottom: 40px;
      }

      .federation-info h2 {
        color: #333;
        margin-bottom: 20px;
      }

      .endpoint-list {
        background: #fff;
        border: 1px solid #e9ecef;
        border-radius: 8px;
        padding: 20px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      }

      .endpoint-item {
        margin-bottom: 10px;
      }

      .endpoint-item:last-child {
        margin-bottom: 0;
      }

      .endpoint-item strong {
        color: #495057;
      }

      .endpoint-item code {
        background: #e9ecef;
        padding: 2px 6px;
        border-radius: 4px;
        font-family: 'Courier New', monospace;
        margin-left: 10px;
      }
    </style>
  </body>
</html>
  `;
}