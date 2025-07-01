import type { User } from '../models.js';
import { renderPostActions } from './postActions.js';

export function renderHome({ user, posts = [] }) {
  return `
    <html>
      <head>
        <title>Home</title>
        <script src="/likes-announces.js"></script>
      </head>
      <body>
        <h1>Welcome${user ? ', ' + user.username : ''}!</h1>
        
        <div class="posts">
          ${posts.map(post => `
            <article class="post" style="border: 1px solid #ccc; margin: 10px 0; padding: 15px;">
              <p>${post.content}</p>
              <small>Posted at ${new Date(post.createdAt).toLocaleString()}</small>
              ${renderPostActions(post._id.toString(), post.likeCount || 0, post.announceCount || 0, post.isLiked || false, post.isAnnounced || false)}
            </article>
          `).join('')}
        </div>
        
        <a href="/">Home</a>
      </body>
    </html>
  `;
}