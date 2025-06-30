import type { User } from '../models';

export function renderUserProfile(user: User) {
  return `
    <html>
      <head>
        <title>${user.name || user.username} - Profile</title>
      </head>
      <body>
        <h1>${user.name || user.username}</h1>
        <p>@${user.username}</p>
        <p>${user.bio || ''}</p>
        <a href="/">Back to home</a>
      </body>
    </html>
  `;
}
