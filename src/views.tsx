import type { FC } from "hono/jsx";
import type { IFollow, IPost, IUser } from "./models.ts";
import { Post } from "./models.ts";

// Utility to linkify text and embed images for imgur/placehold URLs
function linkifyAndEmbed(text: string): string {
  if (!text) return "";
  const escapeHtml = (s: string) =>
    s.replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c] || c,
    );
  let safe = escapeHtml(text);

  // Regex for protocol URLs or bare domains with optional paths
  // Matches: https://foo.com, http://foo.com, foo.com, foo.com/path, www.foo.com/path
  const urlLikeRegex =
    /((https?:\/\/)?([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(\/[\w\-.~:@!$&'()*+,;=/?#%]*)?)/gi;

  // Replace all matches, but skip if already inside an HTML tag
  safe = safe.replace(urlLikeRegex, (match) => {
    // If already inside an anchor or img tag, skip
    // (naive but effective: check for preceding '="' or '>' in the last 60 chars)
    const last60 = safe.slice(
      Math.max(0, safe.lastIndexOf(match) - 60),
      safe.lastIndexOf(match),
    );
    if (/href=|src=|<a |<img /i.test(last60)) return match;

    let url = match;
    const display = match;
    // Add protocol if missing
    if (!/^https?:\/\//i.test(url)) {
      url = `http://${url}`;
    }
    // Image embedding for imgur and placeholder services
    if (
      /https?:\/\/(i\.)?imgur\.com\/(\w+)(\.(jpg|jpeg|png|gif))?/i.test(url)
    ) {
      if (/\.(jpg|jpeg|png|gif)$/i.test(url)) {
        return `<img src="${url}" alt="imgur image" style="width:100%;display:block;margin:0.5em 0;object-fit:contain;" />`;
      }
      return `<a href="${url}" target="_blank" rel="noopener">${display}</a>`;
    }
    if (
      /https?:\/\/(placehold\.it|via\.placeholder\.com|placehold\.co)\//i.test(
        url,
      )
    ) {
      return `<img src="${url}" alt="placeholder image" style="width:100%;display:block;margin:0.5em 0;object-fit:contain;" />`;
    }
    // Otherwise, regular link
    return `<a href="${url}" target="_blank" rel="noopener">${display}</a>`;
  });

  // Replace newlines with <br>
  safe = safe.replace(/\n/g, "<br />");
  return safe;
}

export const Layout: FC<{ user?: IUser; children: unknown }> = ({
  user,
  children,
}) => (
  <html lang="en" data-theme="light">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="color-scheme" content="light" />
      <title>
        {user?.displayName ? `${user.displayName}'s Fongoblog` : "Fongoblog"}
      </title>
      <link
        rel="stylesheet"
        href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css"
      />
      <style>{`
        .container {
          max-width: 1200px;
          margin: 0 auto;
          padding: 1rem;
        }
        .card {
          padding: 1.5rem;
          margin: 2rem 0;
        }
        input:not([type=checkbox],[type=radio]), select, textarea, [type=button], [type=reset], [type=submit] {
          margin-bottom: 0;
        }
        textarea {
          resize: none;
        }
        @media (max-width: 600px) {
          .container {
            padding: 0.5rem;
          }
        }
      `}</style>
    </head>
    <body>
      <main class="container">{children}</main>
      <script
        dangerouslySetInnerHTML={{
          __html: `
(function() {
  function updateStats(postId) {
    fetch('/api/post/' + postId + '/stats').then(r => r.json()).then(data => {
      if (data.ok) {
        var likeBtn = document.querySelector('[data-like-btn][data-post-id="' + postId + '"]');
        var announceBtn = document.querySelector('[data-announce-btn][data-post-id="' + postId + '"]');
        if (likeBtn) {
          likeBtn.querySelector('.like-count').textContent = data.likeCount;
          if (data.liked) likeBtn.classList.add('liked');
          else likeBtn.classList.remove('liked');
        }
        if (announceBtn) {
          announceBtn.querySelector('.announce-count').textContent = data.announceCount;
          if (data.announced) announceBtn.classList.add('announced');
          else announceBtn.classList.remove('announced');
        }
      }
    });
  }

  function updateAllStats() {
    // Collect all post IDs from the page
    var postIds = [];
    document.querySelectorAll('[data-like-btn]').forEach(function(btn) {
      var postId = btn.getAttribute('data-post-id');
      if (postId && !postIds.includes(postId)) {
        postIds.push(postId);
      }
    });

    if (postIds.length === 0) return;

    console.log('Loading stats for', postIds.length, 'posts in a single request');

    // Fetch all stats in one request
    fetch('/api/posts/stats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ postIds: postIds })
    }).then(r => r.json()).then(data => {
      if (data.ok && data.stats) {
        console.log('Received stats for', Object.keys(data.stats).length, 'posts');
        // Update each post's stats
        for (var postId in data.stats) {
          var stats = data.stats[postId];
          var likeBtn = document.querySelector('[data-like-btn][data-post-id="' + postId + '"]');
          var announceBtn = document.querySelector('[data-announce-btn][data-post-id="' + postId + '"]');
          
          if (likeBtn) {
            likeBtn.querySelector('.like-count').textContent = stats.likeCount;
            if (stats.liked) likeBtn.classList.add('liked');
            else likeBtn.classList.remove('liked');
          }
          if (announceBtn) {
            announceBtn.querySelector('.announce-count').textContent = stats.announceCount;
            if (stats.announced) announceBtn.classList.add('announced');
            else announceBtn.classList.remove('announced');
          }
        }
      }
    }).catch(function(error) {
      console.error('Failed to load batch stats:', error);
      // Fallback to individual requests if batch fails
      console.log('Falling back to individual requests...');
      postIds.forEach(function(postId) {
        updateStats(postId);
      });
    });
  }

  document.addEventListener('DOMContentLoaded', function() {
    // Load all stats on page load (single request instead of multiple)
    updateAllStats();

    document.querySelectorAll('[data-like-btn]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var postId = btn.getAttribute('data-post-id');
        var liked = btn.classList.contains('liked');
        fetch(liked ? '/api/unlike' : '/api/like', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ postId })
        }).then(r => r.json()).then(data => {
          if (data.ok) {
            if ('liked' in data) {
              if (data.liked) btn.classList.add('liked');
              else btn.classList.remove('liked');
            } else {
              btn.classList.toggle('liked');
            }
            // Update just this post's stats after interaction
            updateStats(postId);
          }
        });
      });
    });
    
    document.querySelectorAll('[data-announce-btn]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var postId = btn.getAttribute('data-post-id');
        var announced = btn.classList.contains('announced');
        fetch(announced ? '/api/unannounce' : '/api/announce', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ postId })
        }).then(r => r.json()).then(data => {
          if (data.ok) {
            if ('announced' in data) {
              if (data.announced) btn.classList.add('announced');
              else btn.classList.remove('announced');
            } else {
              btn.classList.toggle('announced');
            }
            // Update just this post's stats after interaction
            updateStats(postId);
          }
        });
      });
    });
  });
})();
        `,
        }}
      />
    </body>
  </html>
);

export const SetupForm: FC = () => (
  <>
    <h1>Set up:</h1>
    <form method="post" action="/setup">
      <fieldset>
        <label>
          Username{" "}
          <input
            type="text"
            name="username"
            required
            maxlength={50}
            pattern="^[a-z0-9_\-]+$"
          />
        </label>
        <label>
          Name <input type="text" name="name" required />
        </label>
        <label>
          Password{" "}
          <input type="password" name="password" required minlength={8} />
        </label>
        <label>
          Confirm Password{" "}
          <input
            type="password"
            name="confirm_password"
            required
            minlength={8}
          />
        </label>
      </fieldset>
      <input type="submit" value="Setup" />
    </form>
  </>
);

export const FollowForm: FC = () => (
  <>
    <h3>Follow</h3>
    <form method="post" action="/follow">
      <fieldset>
        <label>
          {" "}
          <input
            type="text"
            name="handle"
            required
            placeholder="@user@example.com"
          />
        </label>
      </fieldset>
      <input type="submit" value="Follow" />
    </form>
  </>
);

export interface ProfileProps {
  name: string;
  username: string;
  handle: string;
  followers: number;
  following: number;
}

export const Profile: FC<ProfileProps> = ({
  name,
  username,
  handle,
  followers,
  following,
}) => (
  <>
    <h1>
      <a href={`/`}>{name}</a>
    </h1>
    <p>
      <a href={`/@${username}`} style={{ userSelect: "all" }}>
        {handle}
      </a>{" "}
      &middot;{" "}
      <a href={`/users/${username}/followers`}>
        {followers === 1 ? "1 follower" : `${followers} followers`}
      </a>{" "}
      &middot;{" "}
      <a href={`/users/${username}/following`}>
        {following === 1 ? "1 following" : `${following} following`}
      </a>
    </p>
  </>
);

export interface HomeProps {
  user: IUser;
  handle: string;
  followers: number;
  following: number;
  posts?: IPost[];
  isProfilePage?: boolean;
  domain?: string;
}

export const Home: FC<HomeProps> = async ({
  user,
  handle,
  followers,
  following,
  posts,
  isProfilePage,
  domain,
}) => {
  // If posts are provided (profile page), use them; otherwise fetch all
  const allPosts = posts ?? (await Post.find().sort({ createdAt: -1 }).exec());
  const postDomain = domain;
  return (
    <>
      {/* Heading/Profile Card with bio and edit */}
      <article class="card">
        <div id="profile-view">
          {user.headerUrl && (
            <div
              style={{
                margin: "-1.5rem -1.5rem 1rem -1.5rem",
              }}
            >
              <img
                src={user.headerUrl}
                alt="Header"
                style={{
                  width: "100%",
                  maxHeight: "280px",
                  objectFit: "cover",
                  borderRadius: "0.5rem 0.5rem 0 0",
                }}
              />
            </div>
          )}
          <div
            style={{
              display: "flex",
              gap: "1rem",
              marginBottom: "1rem",
              alignItems: "center",
            }}
          >
            {user.avatarUrl && (
              <img
                src={user.avatarUrl}
                alt="Avatar"
                style={{
                  width: "64px",
                  height: "64px",
                  borderRadius: "50%",
                  objectFit: "cover",
                }}
              />
            )}
            <div>
              <h1 id="profile-displayName" style={{ marginBottom: "0px" }}>
                <a href="/">{user.displayName}</a>
              </h1>
              <p style={{ marginBottom: "0px" }}>
                <a href={`/@${user.username}`} style={{ userSelect: "all" }}>
                  {handle}
                </a>{" "}
                &middot;{" "}
                <a href={`/users/${user.username}/followers`}>
                  {followers === 1 ? "1 follower" : `${followers} followers`}
                </a>{" "}
                &middot;{" "}
                <a href={`/users/${user.username}/following`}>
                  {following === 1 ? "1 following" : `${following} following`}
                </a>
              </p>
            </div>
          </div>
          <p id="profile-bio" style={{ marginTop: "0.5rem", color: "#666" }}>
            {/* Render bio with links */}
            <span
              dangerouslySetInnerHTML={{
                __html: linkifyAndEmbed(user.bio || ""),
              }}
            />
          </p>
        </div>
        <form
          id="profile-edit-form"
          style={{ display: "none", marginTop: "1rem" }}
        >
          <label>
            Header URL
            <input
              id="edit-headerUrl"
              name="headerUrl"
              type="url"
              defaultValue={user.headerUrl || ""}
              maxLength={300}
              placeholder="https://..."
            />
          </label>
          <label>
            Avatar URL
            <input
              id="edit-avatarUrl"
              name="avatarUrl"
              type="url"
              defaultValue={user.avatarUrl || ""}
              maxLength={300}
              placeholder="https://..."
            />
          </label>
          <label>
            Username
            <input
              id="edit-username"
              name="username"
              type="text"
              value={user.username}
              readOnly
              style={{ cursor: "not-allowed" }}
            />
          </label>
          <label>
            Display Name
            <input
              id="edit-displayName"
              name="displayName"
              type="text"
              defaultValue={user.displayName}
              required
              maxLength={50}
            />
          </label>
          <label>
            Bio
            <textarea
              id="edit-bio"
              name="bio"
              rows={2}
              maxLength={200}
              style={{ resize: "none" }}
            >
              {user.bio || ""}
            </textarea>
          </label>
          <label>
            New Password (leave blank to keep current password)
            <input
              id="edit-password"
              name="password"
              type="password"
              minLength={8}
              maxLength={100}
              autoComplete="new-password"
              placeholder="••••••••"
            />
          </label>
        </form>
      </article>

      {/* Top Auth Card ... now includes Edit/Cancel/Save/Logout buttons */}
      {!isProfilePage && (
        <article class="card">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span id="auth-status">{/* Auth status will be set by JS */}</span>
            <div
              style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
            >
              <span
                id="auth-error"
                style={{ color: "#c00", minWidth: "120px" }}
              ></span>
              <span
                id="profile-error"
                style={{ color: "#c00", minWidth: "120px" }}
              ></span>
              <button
                id="profile-edit-btn"
                type="button"
                style={{ display: "none" }}
              >
                Edit
              </button>
              <button
                id="profile-cancel-btn"
                type="button"
                style={{ display: "none" }}
              >
                Cancel
              </button>
              <button
                id="profile-save-btn"
                type="button"
                style={{ display: "none" }}
              >
                Save
              </button>
              <button id="auth-btn" type="button">
                Login
              </button>
              <input
                id="auth-password"
                type="password"
                placeholder="Enter password"
                style={{ width: "180px", display: "none" }}
                autoComplete="current-password"
              />
            </div>
          </div>
        </article>
      )}

      {/* Follow Someone Card and New Post Card are now wrapped for auth-only visibility */}
      {!isProfilePage && (
        <div id="auth-only" style={{ display: "none" }}>
          {/* Follow Someone Card */}
          <article class="card">
            <FollowForm />
          </article>

          {/* New Post Card */}
          <article class="card">
            <form
              id="post-form"
              method="post"
              action={`/users/${user.username}/posts`}
            >
              {/* Parent post preview (shown when replying) */}
              <div
                id="reply-parent"
                style={{
                  display: "none",
                  marginBottom: "1em",
                  background: "#f8f8f8",
                  borderRadius: "0.5em",
                  padding: "0.75em",
                  border: "1px solid #eee",
                }}
              />
              <input id="replyTo-input" type="hidden" name="replyTo" value="" />
              <div id="thread-composer">
                <div
                  class="thread-textarea"
                  style={{
                    display: "flex",
                    alignItems: "flex-end",
                    gap: "0.5em",
                    marginBottom: "0.5em",
                  }}
                >
                  <textarea
                    name="content[]"
                    required
                    placeholder="What's up?"
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    id="add-thread-btn"
                    title="Add another to thread"
                    style={{
                      fontSize: "1.5em",
                      padding: "0 0.5em",
                      background: "none",
                      border: "none",
                      color: "#0ac",
                      cursor: "pointer",
                    }}
                  >
                    +
                  </button>
                </div>
              </div>
              <span
                id="post-error"
                style={{
                  color: "#c00",
                  minWidth: "120px",
                  display: "block",
                  marginTop: "0.5em",
                  marginBottom: "-0.5em",
                }}
              />
              <input
                id="post-submit-btn"
                type="submit"
                value="Post"
                style={{ marginTop: "1em" }}
              />
            </form>
          </article>
        </div>
      )}

      {/* Timeline Section (posts already in cards) */}
      {allPosts.map((post) => {
        // Determine if this is a remote post and get the correct author info
        const isRemote = post.remote;
        let displayName = user.displayName;
        let avatarUrl = user.avatarUrl;
        let handle = `@${user.username}@${postDomain}`;

        if (isRemote) {
          // For remote posts, extract proper display name and handle from the author URL
          try {
            const url = new URL(post.author);
            const pathParts = url.pathname.split("/").filter(Boolean);

            // Extract username from path (e.g., /@username or /users/username)
            let username = "";
            if (pathParts.length > 0) {
              username = pathParts[pathParts.length - 1];
              // Remove @ prefix if present
              if (username.startsWith("@")) {
                username = username.substring(1);
              }
            }

            // Use stored remote author name or fallback to username
            displayName = post.remoteAuthorName || username || "Remote User";
            avatarUrl = post.remoteAuthorAvatar || "";
            handle = `@${username}@${url.hostname}`;
          } catch (e) {
            // Fallback if URL parsing fails
            displayName = post.remoteAuthorName || "Remote User";
            avatarUrl = post.remoteAuthorAvatar || "";
            handle = post.author;
          }
        }

        return (
          <article
            key={post._id}
            class="card"
            style={{
              display: "flex",
              gap: "1rem",
              alignItems: "flex-start",
              padding: "1.5rem",
              marginBottom: "1.5rem",
            }}
          >
            {/* Post content and meta (avatar removed) */}
            <div style={{ flex: 1 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div>
                  <span style={{ fontWeight: 600 }}>{displayName}</span>
                  <br />
                  <span style={{ color: "#888", fontSize: "0.95em" }}>
                    {handle}
                  </span>
                </div>
                <time
                  dateTime={new Date(post.createdAt).toISOString()}
                  style={{ color: "#888", fontSize: "0.95em" }}
                >
                  {new Date(post.createdAt).toLocaleString()}
                </time>
              </div>
              {/* biome-ignore lint/security/noDangerouslySetInnerHtml: Post content is sanitized */}
              <div
                style={{ margin: "0.75em 0" }}
                dangerouslySetInnerHTML={{
                  __html: isRemote
                    ? post.content
                    : linkifyAndEmbed(post.content),
                }}
              />
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "1.5em",
                  fontSize: "0.98em",
                  color: "#666",
                }}
              >
                <button
                  type="button"
                  class="secondary"
                  data-like-btn
                  data-post-id={post._id}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "#c00",
                    paddingLeft: "0",
                  }}
                  title="Like"
                >
                  ❤️ <span class="like-count">0</span>
                </button>
                <button
                  type="button"
                  class="secondary"
                  data-announce-btn
                  data-post-id={post._id}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "#0ac",
                  }}
                  title="Repost"
                >
                  🔄 <span class="announce-count">0</span>
                </button>
                <button
                  type="button"
                  class="secondary reply-btn"
                  data-post-id={post._id}
                  data-post-content={post.content}
                  data-post-author={displayName}
                  data-post-handle={handle}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "#888",
                  }}
                  title="Reply"
                >
                  💬 0
                </button>
                <a
                  href={
                    isRemote
                      ? post.objectId || post.author
                      : `/users/${post.author}/posts/${post._id}`
                  }
                  class="secondary"
                  target={isRemote ? "_blank" : undefined}
                  rel={isRemote ? "noopener noreferrer" : undefined}
                  style={{ textDecoration: "none", marginLeft: "1em" }}
                >
                  🔗
                </a>
              </div>
            </div>
          </article>
        );
      })}

      {/* Seamless login/logout JS */}
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: Inline script for login/logout and profile edit UI */}
      <script
        dangerouslySetInnerHTML={{
          __html: `
(function() {
  let loggedIn = false;
  let editingProfile = false;
  const authBtn = document.getElementById('auth-btn');
  const authStatus = document.getElementById('auth-status');
  const authError = document.getElementById('auth-error');
  const profileError = document.getElementById('profile-error');
  const pwInput = document.getElementById('auth-password');
  const authOnly = document.getElementById('auth-only');
  // Profile edit elements
  const profileEditBtn = document.getElementById('profile-edit-btn');
  const profileCancelBtn = document.getElementById('profile-cancel-btn');
  const profileSaveBtn = document.getElementById('profile-save-btn');
  const profileView = document.getElementById('profile-view');
  const profileEditForm = document.getElementById('profile-edit-form');
  const profileDisplayName = document.getElementById('profile-displayName');
  const profileBio = document.getElementById('profile-bio');
  const profileUsername = document.getElementById('profile-username');
  const editUsername = document.getElementById('edit-username');
  const editDisplayName = document.getElementById('edit-displayName');
  const editBio = document.getElementById('edit-bio');
  const editAvatarUrl = document.getElementById('edit-avatarUrl');
  const editHeaderUrl = document.getElementById('edit-headerUrl');
  const editPassword = document.getElementById('edit-password');

  function setLoggedInUI() {
    loggedIn = true;
    authBtn.textContent = 'Logout';
    if (authError) authError.textContent = '';
    if (profileError) profileError.textContent = '';
    authStatus.textContent = '';
    pwInput.style.display = 'none';
    pwInput.value = '';
    if (authOnly) authOnly.style.display = 'block';
    if (profileEditBtn) profileEditBtn.style.display = 'inline-block';
    if (profileCancelBtn) profileCancelBtn.style.display = editingProfile ? 'inline-block' : 'none';
    if (profileSaveBtn) profileSaveBtn.style.display = editingProfile ? 'inline-block' : 'none';
  }
  function setLoggedOutUI() {
    loggedIn = false;
    editingProfile = false;
    authBtn.textContent = 'Login';
    if (authError) authError.textContent = '';
    if (profileError) profileError.textContent = '';
    authStatus.textContent = '';
    pwInput.style.display = 'none';
    pwInput.value = '';
    if (authOnly) authOnly.style.display = 'none';
    if (profileEditBtn) profileEditBtn.style.display = 'none';
    if (profileCancelBtn) profileCancelBtn.style.display = 'none';
    if (profileSaveBtn) profileSaveBtn.style.display = 'none';
    if (profileEditForm) profileEditForm.style.display = 'none';
    if (profileView) profileView.style.display = 'block';
  }

  // On page load, check session
  fetch('/session').then(r => r.json()).then(data => {
    if (data.loggedIn) setLoggedInUI();
    else setLoggedOutUI();
  });

  authBtn.addEventListener('click', async () => {
    if (!loggedIn) {
      if (pwInput.style.display === 'none') {
        pwInput.style.display = 'block';
        pwInput.focus();
      } else {
        if (!pwInput.value) {
          pwInput.style.display = 'none';
        } else {
          // Try login
          authBtn.disabled = true;
          authBtn.textContent = 'Logging in...';
          const res = await fetch('/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: pwInput.value })
          });
          authBtn.disabled = false;
          if (res.ok) {
            const data = await res.json();
            if (data.ok) {
              setLoggedInUI();
            } else {
              if (authError) authError.textContent = 'Login failed.';
              pwInput.value = '';
              pwInput.focus();
            }
          } else {
            if (authError) authError.textContent = 'Login failed.';
            pwInput.value = '';
            pwInput.focus();
          }
        }
      }
    } else {
      // Logout
      authBtn.disabled = true;
      authBtn.textContent = 'Logging out...';
      const res = await fetch('/logout', { method: 'POST' });
      authBtn.disabled = false;
      if (res.ok) {
        setLoggedOutUI();
      } else {
        if (authError) authError.textContent = 'Logout failed.';
      }
    }
  });

  // Profile edit logic
  if (profileEditBtn && profileEditForm && profileView && profileCancelBtn && profileSaveBtn) {
    profileEditBtn.addEventListener('click', () => {
      editingProfile = true;
      profileView.style.display = 'none';
      profileEditForm.style.display = 'block';
      profileEditBtn.style.display = 'none';
      profileCancelBtn.style.display = 'inline-block';
      profileSaveBtn.style.display = 'inline-block';
      if (profileError) profileError.textContent = '';
      if (editDisplayName) editDisplayName.value = profileDisplayName.textContent.replace(/'s microblog$/, '');
      if (editBio) editBio.value = profileBio.textContent;
      if (editUsername && profileUsername) editUsername.value = profileUsername.textContent.replace(/^@/, '');
      if (editAvatarUrl) editAvatarUrl.value = document.querySelector('#profile-view img[alt="Avatar"]')?.src || '';
      if (editHeaderUrl) editHeaderUrl.value = document.querySelector('#profile-view img[alt="Header"]')?.src || '';
      if (editPassword) editPassword.value = '';
    });
    profileCancelBtn.addEventListener('click', () => {
      editingProfile = false;
      profileEditForm.style.display = 'none';
      profileView.style.display = 'block';
      profileEditBtn.style.display = 'inline-block';
      profileCancelBtn.style.display = 'none';
      profileSaveBtn.style.display = 'none';
      if (profileError) profileError.textContent = '';
      if (editPassword) editPassword.value = '';
    });
    profileSaveBtn.addEventListener('click', async () => {
      if (!editDisplayName || !editBio || !editAvatarUrl || !editHeaderUrl || !editUsername) return;
      profileSaveBtn.disabled = true;
      profileSaveBtn.textContent = 'Saving...';
      if (profileError) profileError.textContent = '';
      const body = {
        displayName: editDisplayName.value,
        bio: editBio.value,
        avatarUrl: editAvatarUrl.value,
        headerUrl: editHeaderUrl.value,
        username: editUsername.value
      };
      if (editPassword && editPassword.value) {
        body.password = editPassword.value;
      }
      const res = await fetch('/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      profileSaveBtn.disabled = false;
      profileSaveBtn.textContent = 'Save';
      if (res.ok) {
        profileDisplayName.textContent = editDisplayName.value + "";
        profileBio.textContent = editBio.value;
        if (profileUsername) profileUsername.textContent = '@' + editUsername.value;
        // Update avatar and header images
        const avatarImg = document.querySelector('#profile-view img[alt="Avatar"]');
        if (avatarImg) avatarImg.src = editAvatarUrl.value;
        const headerImg = document.querySelector('#profile-view img[alt="Header"]');
        if (headerImg) headerImg.src = editHeaderUrl.value;
        profileEditForm.style.display = 'none';
        profileView.style.display = 'block';
        profileEditBtn.style.display = 'inline-block';
        profileCancelBtn.style.display = 'none';
        profileSaveBtn.style.display = 'none';
        editingProfile = false;
        if (profileError) profileError.textContent = '';
        if (editPassword) editPassword.value = '';
      } else {
        if (profileError) profileError.textContent = 'Failed to update profile.';
      }
    });
  }

  // Reply button logic
  document.querySelectorAll('.reply-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var postId = btn.getAttribute('data-post-id');
      var postContent = btn.getAttribute('data-post-content');
      var postAuthor = btn.getAttribute('data-post-author');
      var postHandle = btn.getAttribute('data-post-handle');
      var replyInput = document.getElementById('replyTo-input');
      var replyParent = document.getElementById('reply-parent');
      var postForm = document.getElementById('post-form');
      if (replyInput && replyParent && postForm) {
        replyInput.value = postId;
        replyParent.style.display = '';
        replyParent.innerHTML = '<b>Replying to ' + postAuthor + ' ' + postHandle + ':</b><br><span style="color:#666">' + postContent + '</span>';
        postForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
        postForm.querySelector('textarea').focus();
      }
    });
  });

  // Thread composer logic
  var threadComposer = document.getElementById('thread-composer');
  var addThreadBtn = document.getElementById('add-thread-btn');
  var postSubmitBtn = document.getElementById('post-submit-btn');
  var postForm = document.getElementById('post-form');
  var postError = document.getElementById('post-error');
  if (threadComposer && addThreadBtn && postSubmitBtn) {
    addThreadBtn.addEventListener('click', function() {
      var newDiv = document.createElement('div');
      newDiv.className = 'thread-textarea';
      newDiv.style.display = 'flex';
      newDiv.style.alignItems = 'flex-end';
      newDiv.style.gap = '0.5em';
      newDiv.style.marginBottom = '0.5em';
      var textarea = document.createElement('textarea');
      textarea.name = 'content[]';
      textarea.required = true;
      textarea.placeholder = "Add another to thread...";
      textarea.style.flex = '1';
      var removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.title = 'Remove this post';
      removeBtn.textContent = '–';
      removeBtn.style.fontSize = '1.5em';
      removeBtn.style.padding = '0 0.5em';
      removeBtn.style.background = 'none';
      removeBtn.style.border = 'none';
      removeBtn.style.color = '#c00';
      removeBtn.style.cursor = 'pointer';
      removeBtn.addEventListener('click', function() {
        threadComposer.removeChild(newDiv);
      });
      newDiv.appendChild(textarea);
      newDiv.appendChild(removeBtn);
      threadComposer.appendChild(newDiv);
      // Move the Post button to the bottom
      threadComposer.parentNode.appendChild(postSubmitBtn);
      textarea.focus();
    });
  }
  // Post form submit: make button reactive
  if (postForm && postSubmitBtn) {
    postForm.addEventListener('submit', async function(e) {
      e.preventDefault();
      if (postError) postError.textContent = '';
      postSubmitBtn.disabled = true;
      postSubmitBtn.value = 'Posting...';
      // Gather all textarea values
      var textareas = postForm.querySelectorAll('textarea[name="content[]"]');
      var contents = Array.from(textareas).map(t => t.value.trim()).filter(Boolean);
      if (!contents.length) {
        if (postError) postError.textContent = 'Content is required.';
        postSubmitBtn.disabled = false;
        postSubmitBtn.value = 'Post';
        return;
      }
      var replyTo = postForm.querySelector('#replyTo-input')?.value || '';
      var formData = {
        'content[]': contents,
        replyTo: replyTo
      };
      try {
        // Use FormData to submit as multipart/form-data
        const fd = new FormData(postForm);
        const res = await fetch(postForm.action, {
          method: 'POST',
          body: fd
        });
        if (res.ok) {
          // Success: clear textareas, reset button, hide reply parent
          textareas.forEach(t => t.value = '');
          if (postError) postError.textContent = '';
          postSubmitBtn.disabled = false;
          postSubmitBtn.value = 'Post';
          var replyParent = document.getElementById('reply-parent');
          if (replyParent) {
            replyParent.style.display = 'none';
            replyParent.innerHTML = '';
          }
          postForm.querySelector('#replyTo-input').value = '';
          // Optionally, reload page to show new post
          window.location.reload();
        } else {
          const errText = await res.text();
          if (postError) postError.textContent = errText || 'Failed to post.';
          postSubmitBtn.disabled = false;
          postSubmitBtn.value = 'Post';
        }
      } catch (err) {
        if (postError) postError.textContent = 'Failed to post.';
        postSubmitBtn.disabled = false;
        postSubmitBtn.value = 'Post';
      }
    });
  }

  // Make Enter in password input trigger login button
  if (pwInput && authBtn) {
    pwInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        authBtn.click();
      }
    });
  }
})();
        `,
        }}
      />
    </>
  );
};

export interface PostViewProps {
  post: IPost;
}

export const PostView: FC<
  PostViewProps & { user?: IUser; domain?: string }
> = ({ post, user, domain }) => {
  // Use user and domain if provided for avatar, display name, handle
  return (
    <article
      class="card"
      style={{
        display: "flex",
        gap: "1rem",
        alignItems: "flex-start",
        padding: "1.5rem",
        marginBottom: "1.5rem",
      }}
    >
      {/* Post content and meta (avatar removed) */}
      <div style={{ flex: 1 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <span style={{ fontWeight: 600 }}>
              {user?.displayName || post.author}
            </span>
            <br />
            <span style={{ color: "#888", fontSize: "0.95em" }}>
              @{user?.username || post.author}
              {domain ? `@${domain}` : ""}
            </span>
          </div>
          <time
            dateTime={new Date(post.createdAt).toISOString()}
            style={{ color: "#888", fontSize: "0.95em" }}
          >
            {new Date(post.createdAt).toLocaleString()}
          </time>
        </div>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: Post content is sanitized */}
        <div
          style={{ margin: "0.75em 0" }}
          dangerouslySetInnerHTML={{
            __html: post.remote ? post.content : linkifyAndEmbed(post.content),
          }}
        />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "1.5em",
            fontSize: "0.98em",
            color: "#666",
          }}
        >
          <button
            type="button"
            class="secondary"
            data-like-btn
            data-post-id={post._id}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "#c00",
              paddingLeft: "0",
            }}
            title="Like"
          >
            ❤️ <span class="like-count">0</span>
          </button>
          <button
            type="button"
            class="secondary"
            data-announce-btn
            data-post-id={post._id}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "#0ac",
            }}
            title="Repost"
          >
            🔄 <span class="announce-count">0</span>
          </button>
          <button
            type="button"
            class="secondary reply-btn"
            data-post-id={post._id}
            data-post-content={post.content}
            data-post-author={user?.displayName || post.author}
            data-post-handle={`@${user?.username || post.author}${domain ? `@${domain}` : ""}`}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "#888",
            }}
            title="Reply"
          >
            💬 0
          </button>
          <a
            href={
              post.remote
                ? post.objectId || post.author
                : `/users/${post.author}/posts/${post._id}`
            }
            class="secondary"
            target={post.remote ? "_blank" : undefined}
            rel={post.remote ? "noopener noreferrer" : undefined}
            style={{ textDecoration: "none", marginLeft: "1em" }}
          >
            🔗
          </a>
        </div>
      </div>
    </article>
  );
};

export interface PostPageProps extends ProfileProps, PostViewProps {
  user?: IUser;
  domain?: string;
}

export const PostPage: FC<PostPageProps> = (props) => (
  <>
    <article class="card">
      <div id="profile-view">
        {props.user?.headerUrl && (
          <div
            style={{
              margin: "-1.5rem -1.5rem 1rem -1.5rem",
            }}
          >
            <img
              src={props.user.headerUrl}
              alt="Header"
              style={{
                width: "100%",
                maxHeight: "280px",
                objectFit: "cover",
                borderRadius: "0.5rem 0.5rem 0 0",
              }}
            />
          </div>
        )}
        <div
          style={{
            display: "flex",
            gap: "1rem",
            marginBottom: "1rem",
            alignItems: "center",
          }}
        >
          {props.user?.avatarUrl && (
            <img
              src={props.user.avatarUrl}
              alt="Avatar"
              style={{
                width: "64px",
                height: "64px",
                borderRadius: "50%",
                objectFit: "cover",
              }}
            />
          )}
          <div>
            <h1 id="profile-displayName" style={{ marginBottom: "0px" }}>
              <a href="/">{props.user?.displayName || props.name}</a>
            </h1>
            <p style={{ marginBottom: "0px" }}>
              <a
                href={`/@${props.user?.username || props.username}`}
                style={{ userSelect: "all" }}
              >
                {props.handle}
              </a>{" "}
              &middot;{" "}
              <a
                href={`/users/${props.user?.username || props.username}/followers`}
              >
                {props.followers === 1
                  ? "1 follower"
                  : `${props.followers} followers`}
              </a>{" "}
              &middot;{" "}
              <a
                href={`/users/${props.user?.username || props.username}/following`}
              >
                {props.following === 1
                  ? "1 following"
                  : `${props.following} following`}
              </a>
            </p>
          </div>
        </div>
        <p id="profile-bio" style={{ marginTop: "0.5rem", color: "#666" }}>
          {/* Render bio with links */}
          <span
            dangerouslySetInnerHTML={{
              __html: linkifyAndEmbed(props.user?.bio || ""),
            }}
          />
        </p>
      </div>
    </article>
    <PostView post={props.post} user={props.user} domain={props.domain} />
  </>
);

export interface FollowerListProps {
  followers: IFollow[];
}

export const FollowerList: FC<FollowerListProps> = ({ followers }) => (
  <>
    <h2>Followers</h2>
    <ul>
      {followers.map((follower) => (
        <li key={follower.follower}>
          <a href={follower.follower} class="secondary">
            {follower.follower}
          </a>
        </li>
      ))}
    </ul>
  </>
);

export interface FollowingListProps {
  following: IFollow[];
}

export const FollowingList: FC<FollowingListProps> = ({ following }) => (
  <>
    <h2>Following</h2>
    <ul>
      {following.map((follow) => (
        <li key={follow.following}>
          <a href={follow.following} class="secondary">
            {follow.following}
          </a>
          <form
            method="post"
            action="/unfollow"
            style={{ display: "inline", marginLeft: "1rem" }}
          >
            <input type="hidden" name="following" value={follow.following} />
            <button
              type="submit"
              class="secondary"
              style={{
                fontSize: "0.9em",
                background: "none",
                border: "none",
                padding: "0",
                cursor: "pointer",
                textDecoration: "underline",
              }}
            >
              Unfollow
            </button>
          </form>
        </li>
      ))}
    </ul>
  </>
);
