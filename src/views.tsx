import type { FC } from "hono/jsx";
import type { IFollow, IPost, IUser } from "./models.ts";
import { Post } from "./models.ts";

export const Layout: FC = (props) => (
  <html lang="en" data-theme="light">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="color-scheme" content="light" />
      <title>Fongoblog - "Wendy"</title>
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
      <main class="container">{props.children}</main>
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
  const postDomain = domain || "localhost";
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
              alignItems: "center",
              gap: "1rem",
              marginBottom: "1rem",
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
              <h1 id="profile-displayName">
                <a href="/">{user.displayName}</a>
              </h1>
              <p>
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
              <p
                id="profile-bio"
                style={{ marginTop: "0.5rem", color: "#666" }}
              >
                {user.bio || ""}
              </p>
            </div>
          </div>
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

      {/* Top Auth Card ... now includes Edit/Cancel/Save buttons */}
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
            {/* Avatar */}
            <div style={{ flex: "0 0 48px" }}>
              {/* TODO: Replace with actual avatar lookup if available */}
              <img
                src={user.avatarUrl || ""}
                alt="Avatar"
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: "50%",
                  objectFit: "cover",
                  background: "#eee",
                }}
              />
            </div>
            {/* Post content and meta */}
            <div style={{ flex: 1 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div>
                  <span style={{ fontWeight: 600 }}>{user.displayName}</span>
                  <span
                    style={{ color: "#888", marginLeft: 8, fontSize: "0.95em" }}
                  >
                    @{user.username}@{postDomain}
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
                dangerouslySetInnerHTML={{ __html: post.content }}
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
                <a
                  href={`/users/${post.author}/posts/${post._id}`}
                  class="secondary"
                >
                  Permalink
                </a>
                {/* Like, Repost, Reply buttons (UI only) */}
                <button
                  type="button"
                  class="secondary"
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "#c00",
                  }}
                  title="Like"
                >
                  ❤️ 0
                </button>
                <button
                  type="button"
                  class="secondary"
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "#0ac",
                  }}
                  title="Repost"
                >
                  🔄 0
                </button>
                <button
                  type="button"
                  class="secondary reply-btn"
                  data-post-id={post._id}
                  data-post-content={post.content}
                  data-post-author={user.displayName}
                  data-post-handle={`@${user.username}@${postDomain}`}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "#888",
                  }}
                  title="Reply"
                >
                  💬
                </button>
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
    authStatus.textContent = 'You are signed in.';
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
    authStatus.textContent = 'You are not signed in.';
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
              authStatus.textContent = 'Login failed.';
              pwInput.value = '';
              pwInput.focus();
            }
          } else {
            authStatus.textContent = 'Login failed.';
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
        authStatus.textContent = 'Logout failed.';
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
      if (editPassword) editPassword.value = '';
    });
    profileSaveBtn.addEventListener('click', async () => {
      if (!editDisplayName || !editBio || !editAvatarUrl || !editHeaderUrl || !editUsername) return;
      profileSaveBtn.disabled = true;
      profileSaveBtn.textContent = 'Saving...';
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
        if (editPassword) editPassword.value = '';
      } else {
        alert('Failed to update profile.');
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

export const PostView: FC<PostViewProps> = ({ post }) => (
  <article class="card" style={{ padding: "1rem" }}>
    <header>
      <strong>{post.author}</strong>
    </header>
    {/* biome-ignore lint/security/noDangerouslySetInnerHtml: Post content is sanitized */}
    <div dangerouslySetInnerHTML={{ __html: post.content }} />
    <footer>
      <time dateTime={new Date(post.createdAt).toISOString()}>
        {new Date(post.createdAt).toLocaleString()}
      </time>
    </footer>
  </article>
);

export interface PostPageProps extends ProfileProps, PostViewProps {}

export const PostPage: FC<PostPageProps> = (props) => (
  <>
    <Profile
      name={props.name}
      username={props.username}
      handle={props.handle}
      followers={props.followers}
      following={props.following}
    />
    <PostView post={props.post} />
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
