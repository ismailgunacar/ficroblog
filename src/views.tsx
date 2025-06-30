import type { FC } from "hono/jsx";
import { DateTime } from "luxon";
import type { Actor, Post, User } from "./schema.ts";
import { makeLinksClickable } from "./utils.ts";

export const Layout: FC<{
  user?: User & Actor;
  isAuthenticated?: boolean;
  children?: any;
}> = (props) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta
        name="viewport"
        content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"
      />
      <meta name="color-scheme" content="light dark" />
      <title>Fongoblog - Single User Microblog</title>
      {/* Load CSS with high priority to prevent layout shifts */}
      <link
        rel="stylesheet"
        href="https://cdn.jsdelivr.net/npm/@picocss/pico@1/css/pico.min.css"
        media="all"
      />
      <style>{`
        html, body {
          overflow-x: hidden;
          max-width: 100vw;
        }
        body, .container, .main, .content, .post, .profile, .timeline {
          width: 100%;
          box-sizing: border-box;
        }
        [style*='margin-left'], [style*='padding-left'] {
          max-width: 100%;
          box-sizing: border-box;
        }
        pre, code {
          word-break: break-word;
          white-space: pre-wrap;
        }
        .secondary { color: var(--muted-color); }
        .u-url { text-decoration: none; }
        .mention { color: var(--primary-color); }
        .mention:hover { text-decoration: underline; }
        .post-actions { display: flex; gap: 1rem; align-items: center; margin-top: 0.5rem; }
        .post-actions button { margin: 0; padding: 0.25rem 0.5rem; font-size: 0.875rem; }
        .post-actions .liked { background-color: var(--primary-color); color: white; }
        .post-actions .reposted { background-color: var(--secondary-color); color: white; }
        .actor-list { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.5rem; }
        .actor-list a { font-size: 0.875rem; }
        .replies { margin-left: 2rem; padding-left: 1rem; border-left: 2px solid var(--muted-color); }
        .replies .post { margin-bottom: 1rem; }
        .replies .replies { margin-left: 1rem; }
        .replies .replies .replies { margin-left: 0.5rem; }
        .replies .replies .replies .replies { margin-left: 0.25rem; }
        .replies .replies .replies .replies .replies { margin-left: 0; }
        .replies .replies .replies .replies .replies .replies { margin-left: 0; }
        .replies .replies .replies .replies .replies .replies .replies { margin-left: 0; }
        .replies .replies .replies .replies .replies .replies .replies .replies { margin-left: 0; }
        .replies .replies .replies .replies .replies .replies .replies .replies .replies { margin-left: 0; }
        .replies .replies .replies .replies .replies .replies .replies .replies .replies .replies { margin-left: 0; }
      `}</style>
    </head>
    <body>
      <main class="container">{props.children}</main>
      <script
        dangerouslySetInnerHTML={{
          __html: `
          document.addEventListener('DOMContentLoaded', function() {
            document.querySelectorAll('[data-reply-toggle]').forEach(function(btn) {
              btn.addEventListener('click', function() {
                var formId = btn.getAttribute('data-reply-toggle');
                var form = document.getElementById(formId);
                if (form) {
                  form.style.display = (form.style.display === 'none' || !form.style.display) ? 'block' : 'none';
                }
              });
            });
          });
        `,
        }}
      />
    </body>
  </html>
);

export const SetupForm: FC = () => (
  <>
    <h1>Set up your microblog</h1>
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
          Bio{" "}
          <textarea
            name="bio"
            placeholder="Tell the fediverse about yourself..."
            maxlength={500}
            rows={3}
          />
        </label>
        <label>
          Password{" "}
          <input
            type="password"
            name="password"
            required
            minlength={8}
            placeholder="Minimum 8 characters"
          />
        </label>
      </fieldset>
      <input type="submit" value="Setup" />
    </form>
    <p>
      <a href="/login">Already have an account? Login here</a>
    </p>
  </>
);

export const LoginForm: FC = () => (
  <>
    <h1>Welcome back</h1>
    <form method="post" action="/login">
      <fieldset>
        <label>
          Password
          <input
            type="password"
            name="password"
            required
            autoFocus
            autoComplete="current-password"
          />
        </label>
      </fieldset>
      <input type="submit" value="Login" />
    </form>
  </>
);

export interface ProfileProps {
  name: string;
  username: string;
  handle: string;
  bio?: string;
  following: number;
  followers: number;
  isAuthenticated?: boolean;
}

export const Profile: FC<ProfileProps> = ({
  name,
  username,
  handle,
  bio,
  following,
  followers,
  isAuthenticated = false,
}) => (
  <>
    <hgroup>
      <h1>
        <a href="/">{name}</a>
      </h1>
      <p>
        <span style="user-select: all;">{handle}</span> &middot;{" "}
        <a href={`/@${username}/following`}>{following} following</a> &middot;{" "}
        <a href={`/@${username}/followers`}>
          {followers === 1 ? "1 follower" : `${followers} followers`}
        </a>
        {isAuthenticated && (
          <>
            {" "}
            &middot; <a href="/profile/edit">Edit Profile</a>
          </>
        )}
      </p>
      {bio && (
        <div
          style="font-style: italic; margin-top: 0.5rem;"
          dangerouslySetInnerHTML={{ __html: makeLinksClickable(bio) }}
        />
      )}
    </hgroup>
  </>
);

export interface HomeProps extends PostListProps {
  user: User & Actor;
  isAuthenticated?: boolean;
}

export const Home: FC<HomeProps> = ({
  user,
  posts,
  isAuthenticated = false,
}) => (
  <>
    {/* Profile header with bio */}
    <hgroup>
      <h1>
        <a href="/">{user.name}</a>
      </h1>
      <p>
        <span style="user-select: all;">{user.handle}</span> &middot;{" "}
        <a href={`/@${user.username}/following`}>{user.following} following</a>{" "}
        &middot;{" "}
        <a href={`/@${user.username}/followers`}>
          {user.followers === 1 ? "1 follower" : `${user.followers} followers`}
        </a>
        {isAuthenticated ? (
          <>
            {" "}
            &middot; <a href="/profile/edit">Edit Profile</a>
            {" | "}
            <a href="/logout">Logout</a>
          </>
        ) : (
          <>
            {" "}
            &middot; <a href="/login">Login</a>
          </>
        )}
      </p>
      {user.summary && (
        <div
          style="font-style: italic; margin-top: 0.5rem;"
          dangerouslySetInnerHTML={{ __html: makeLinksClickable(user.summary) }}
        />
      )}
    </hgroup>

    {/* Only show follow form and post form when authenticated */}
    {isAuthenticated && (
      <>
        <form method="post" action={`/users/${user.username}/following`}>
          {/* biome-ignore lint/a11y/noRedundantRoles: PicoCSS requires role=group */}
          <fieldset role="group">
            <input
              type="text"
              name="actor"
              required={true}
              placeholder="Enter an actor handle (e.g., @johndoe@mastodon.com) or URI (e.g., https://mastodon.com/@johndoe)"
            />
            <input type="submit" value="Follow" />
          </fieldset>
        </form>
        <form method="post" action="/">
          <fieldset>
            <label>
              What's on your mind?
              <textarea
                name="content"
                required={true}
                placeholder="Share your thoughts..."
                rows={3}
                maxlength={500}
              />
            </label>
          </fieldset>
          <input type="submit" value="Post" />
        </form>
      </>
    )}

    <div id="posts-container">
      <PostList posts={posts} isAuthenticated={isAuthenticated} />
    </div>

    {/* Loading indicator */}
    <div
      id="loading-indicator"
      style={{ display: "none", textAlign: "center", padding: "1rem" }}
    >
      <p>Loading more posts...</p>
    </div>

    {/* End of posts indicator */}
    <div
      id="end-of-posts"
      style={{ display: "none", textAlign: "center", padding: "1rem" }}
    >
      <p>
        <small>You've reached the end!</small>
      </p>
    </div>

    {/* Infinite scroll script */}
    <script
      dangerouslySetInnerHTML={{
        __html: `
        let isLoading = false;
        let hasMore = true;
        let nextCursor = null;
        
        function loadMorePosts() {
          if (isLoading || !hasMore) return;
          
          isLoading = true;
          document.getElementById('loading-indicator').style.display = 'block';
          
          const url = '/api/posts' + (nextCursor ? '?cursor=' + nextCursor : '');
          
          fetch(url)
            .then(response => response.json())
            .then(data => {
              const container = document.getElementById('posts-container');
              
              data.posts.forEach(post => {
                const postDiv = document.createElement('div');
                postDiv.innerHTML = createPostHTML(post);
                container.appendChild(postDiv.firstChild);
              });
              
              hasMore = data.hasMore;
              nextCursor = data.nextCursor;
              
              if (!hasMore) {
                document.getElementById('end-of-posts').style.display = 'block';
              }
            })
            .catch(error => {
              console.error('Error loading more posts:', error);
            })
            .finally(() => {
              isLoading = false;
              document.getElementById('loading-indicator').style.display = 'none';
            });
        }
        
        function createPostHTML(post) {
          const formatTimestamp = (timestamp) => {
            try {
              const date = new Date(timestamp);
              return {
                iso: date.toISOString(),
                display: date.toLocaleString()
              };
            } catch (error) {
              return { iso: '', display: 'Invalid date' };
            }
          };
          const timestamp = formatTimestamp(post.created);
          const isLocal = post.user_id || (post.handle && (post.handle.includes('@gunac.ar') || post.handle.includes('@localhost:8000')));
          const username = post.handle.split('@')[1] || post.handle.split('@')[0];
          const href = isLocal ? '/users/' + username : (post.url || post.uri);
          return \`
            <article>
              <header>
                \${post.name ? 
                  '<a href="' + href + '"><strong>' + post.name + '</strong></a> <small>(<a href="' + href + '" class="secondary">' + post.handle + '</a>)</small>' :
                  '<a href="' + href + '" class="secondary">' + post.handle + '</a>'
                }
              </header>
              <div>\${makeLinksClickable(post.content)}</div>
              <footer>
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <a href="\${post.url || post.uri}">
                    <time datetime="\${timestamp.iso}">\${timestamp.display}</time>
                  </a>
                  <div style="display: flex; gap: 1rem; align-items: center; color: var(--muted-color);">
                    <span>🤍 \${post.likesCount || 0}</span>
                    <span>🔄 \${post.repostsCount || 0}</span>
                  </div>
                </div>
              </footer>
            </article>
          \`;
        }
        // Scroll event listener
        function handleScroll() {
          if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight - 1000) {
            loadMorePosts();
          }
        }
        window.addEventListener('scroll', handleScroll);
        document.addEventListener('DOMContentLoaded', function() {
          const posts = document.querySelectorAll('[data-post-id]');
          if (posts.length > 0) {
            const lastPost = posts[posts.length - 1];
            nextCursor = lastPost.dataset.postId;
          }
        });
      `,
      }}
    />
  </>
);

export interface PostListProps {
  posts: (Post & Actor)[];
  isAuthenticated?: boolean;
}

export const PostList: FC<PostListProps> = ({
  posts,
  isAuthenticated = false,
}) => {
  // Recursively flatten actor fields into post object and its replies
  function flattenActor(post: any, depth = 0): any {
    let flat = post;
    if (post && post.actor && typeof post.actor === "object") {
      const { actor, ...rest } = post;
      flat = { ...actor, ...rest };
    }
    if (Array.isArray(flat.replies)) {
      flat.replies = flat.replies.map((r: any) => flattenActor(r, depth + 1));
    }
    return flat;
  }
  return (
    <>
      {posts.map((post: any) => {
        const flatPost = flattenActor(post);
        return (
          <div
            key={flatPost.id}
            id={`post-${flatPost.id}`}
            data-post-id={flatPost.id}
          >
            <PostView post={flatPost} isAuthenticated={isAuthenticated} />
            {/* Render replies if present */}
            {Array.isArray(flatPost.replies) && flatPost.replies.length > 0 && (
              <div style={{ marginLeft: "2rem", paddingLeft: "1rem" }}>
                <PostList
                  posts={flatPost.replies}
                  isAuthenticated={isAuthenticated}
                />
              </div>
            )}
          </div>
        );
      })}
    </>
  );
};

export interface PostViewProps {
  post: Post &
    Actor & {
      likesCount?: number;
      repostsCount?: number;
      isLikedByUser?: boolean;
      isRepostedByUser?: boolean;
      replies?: any[];
      like_actors?: Actor[];
      repost_actors?: Actor[];
      parent_post?: Post & Actor;
    };
  isAuthenticated?: boolean;
}

export const PostView: FC<PostViewProps> = ({
  post,
  isAuthenticated = false,
}) => {
  // Helper function to safely format timestamp
  const formatTimestamp = (
    timestamp: any,
  ): { iso: string; display: string } => {
    try {
      const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
      if (isNaN(date.getTime())) {
        return { iso: "", display: "Invalid date" };
      }
      return {
        iso: date.toISOString(),
        display: date.toLocaleString(),
      };
    } catch (error) {
      console.error(
        "Error formatting timestamp:",
        error,
        "Raw timestamp:",
        timestamp,
      );
      return { iso: "", display: "Invalid date" };
    }
  };

  const timestamp = formatTimestamp(post.created);

  const handleLike = async (e: Event) => {
    e.preventDefault();
    try {
      const response = await fetch(`/posts/${post.id}/like`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (response.ok) {
        // Reload the page to update the like status
        window.location.reload();
      }
    } catch (error) {
      console.error("Failed to like post:", error);
    }
  };

  const handleRepost = async (e: Event) => {
    e.preventDefault();
    try {
      const response = await fetch(`/posts/${post.id}/repost`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (response.ok) {
        // Reload the page to update the repost status
        window.location.reload();
      }
    } catch (error) {
      console.error("Failed to repost post:", error);
    }
  };

  // Reply form state (simple, non-reactive for SSR)
  const replyFormId = `reply-form-${post.id}`;

  // Helper to render actors (for likes/reposts)
  const renderActorList = (actors: Actor[] | undefined) => {
    if (!Array.isArray(actors) || actors.length === 0) return null;
    // Only show valid actors with a handle (or other required property)
    const validActors = actors.filter((actor): actor is Actor =>
      Boolean(
        actor && typeof actor.handle === "string" && actor.handle.trim() !== "",
      ),
    );
    if (validActors.length === 0) return null;
    return (
      <span style={{ fontSize: "0.9em", color: "#888" }}>
        {validActors.slice(0, 8).map((actor, i) => (
          <span key={actor.id}>
            <ActorLink actor={actor} />
            {i < validActors.length - 1 ? ", " : ""}
          </span>
        ))}
        {validActors.length > 8 && (
          <span> and {validActors.length - 8} more</span>
        )}
      </span>
    );
  };

  // Update getPostPageUrl to use /@:username/posts/:id for local posts
  const getPostPageUrl = () => {
    if (post.user_id && post.handle) {
      // Extract username from handle (e.g., @username@domain)
      const handle = post.handle.startsWith("@")
        ? post.handle.slice(1)
        : post.handle;
      const username = handle.split("@")[0];
      const url = `/@${username}/posts/${post.id}`;
      return url;
    }
    // Fallback to post.url or post.uri
    const fallbackUrl = post.url || post.uri;
    return fallbackUrl;
  };

  // Calculate the post URL once and reuse it
  const postUrl = getPostPageUrl();

  // Determine if we are already on the canonical post page
  let isOnPostPage = false;
  if (typeof window !== "undefined") {
    try {
      isOnPostPage = window.location.pathname === postUrl;
    } catch {}
  }

  return (
    <>
      <article
        style={{
          marginBottom: "2rem",
          borderLeft: post.reply_to ? "2px solid #ccc" : undefined,
          paddingLeft: post.reply_to ? "1rem" : undefined,
        }}
      >
        <header>
          <ActorLink actor={post} />
        </header>
        {/* Render post content: only linkify mentions for local posts */}
        {post.user_id != null ? (
          <div
            dangerouslySetInnerHTML={{
              __html: makeLinksClickable(
                replaceMentionsWithLinks(post.content),
              ),
            }}
          />
        ) : (
          <div dangerouslySetInnerHTML={{ __html: post.content }} />
        )}
        <footer>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span
              style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
            >
              <a href={postUrl}>
                <time datetime={timestamp.iso}>{timestamp.display}</time>
              </a>
              {/* Permalink icon/link */}
              {typeof window !== "undefined" && isOnPostPage ? (
                <span
                  title="Permalink to this post"
                  style={{
                    fontSize: "1.1em",
                    textDecoration: "none",
                    opacity: 0.5,
                    cursor: "default",
                  }}
                >
                  🔗
                </span>
              ) : (
                <a
                  href={postUrl}
                  title="Permalink to this post"
                  style={{ fontSize: "1.1em", textDecoration: "none" }}
                >
                  🔗
                </a>
              )}
            </span>
            {isAuthenticated && !post.deleted && (
              <form
                method="post"
                action={`/posts/${post.id}/delete`}
                style={{ display: "inline" }}
                onSubmit={(e) => {
                  if (!confirm("Delete this post?")) e.preventDefault();
                }}
              >
                <button
                  type="submit"
                  style={{
                    color: "red",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                  }}
                >
                  🗑️ Delete
                </button>
              </form>
            )}
          </div>
          <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
            <button
              type="button"
              onClick={handleLike}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "0.25rem",
                color: post.isLikedByUser ? "red" : "inherit",
              }}
              title={post.isLikedByUser ? "Unlike" : "Like"}
            >
              {post.isLikedByUser ? "❤️" : "🤍"} {post.likesCount || 0}
            </button>
            {Array.isArray(post.like_actors) &&
              post.like_actors.some(
                (a) =>
                  a && typeof a.handle === "string" && a.handle.trim() !== "",
              ) &&
              renderActorList(post.like_actors)}
            <button
              type="button"
              onClick={handleRepost}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "0.25rem",
                color: post.isRepostedByUser ? "green" : "inherit",
              }}
              title={post.isRepostedByUser ? "Unrepost" : "Repost"}
            >
              {post.isRepostedByUser ? "🔁" : "🔄"} {post.repostsCount || 0}
            </button>
            {renderActorList(post.repost_actors)}
            {/* Reply button toggles reply form */}
            {isAuthenticated && (
              <button type="button" data-reply-toggle={replyFormId}>
                💬 Reply
              </button>
            )}
          </div>
        </footer>
      </article>
      {/* Reply form, hidden by default, toggled by reply button */}
      <form
        id={replyFormId}
        method="post"
        action="/"
        style={{
          display: "none",
          marginTop: "1rem",
          marginLeft: "2rem",
          borderLeft: "2px solid #eee",
          paddingLeft: "1rem",
        }}
      >
        <input type="hidden" name="reply_to" value={post.id} />
        <fieldset>
          <label>
            Reply:
            <textarea
              name="content"
              required
              rows={2}
              maxLength={500}
              placeholder="Write your reply..."
            />
          </label>
        </fieldset>
        <input type="submit" value="Reply" />
      </form>
    </>
  );
};

export interface PostPageProps extends ProfileProps, PostViewProps {}

export const PostPage: FC<PostPageProps> = (props) => (
  <>
    <hgroup>
      <h1>
        <a href="/">{props.name}</a>
      </h1>
      <p>
        <span style="user-select: all;">{props.handle}</span> &middot;{" "}
        <a href={`/@${props.username}/following`}>
          {props.following} following
        </a>{" "}
        &middot;{" "}
        <a href={`/@${props.username}/followers`}>
          {props.followers === 1
            ? "1 follower"
            : `${props.followers} followers`}
        </a>
        {props.isAuthenticated && (
          <>
            {" "}
            &middot; <a href="/profile/edit">Edit Profile</a>
          </>
        )}
      </p>
      {props.bio && (
        <div
          style="font-style: italic; margin-top: 0.5rem;"
          dangerouslySetInnerHTML={{ __html: makeLinksClickable(props.bio) }}
        />
      )}
    </hgroup>
    <PostView post={props.post} isAuthenticated={props.isAuthenticated} />
    {/* Show replies to this post, if any */}
    {Array.isArray(props.post.replies) && props.post.replies.length > 0 && (
      <section
        style={{ marginLeft: "2rem", paddingLeft: "1rem", marginTop: "2rem" }}
      >
        <h3>Replies</h3>
        <PostList
          posts={props.post.replies}
          isAuthenticated={props.isAuthenticated}
        />
      </section>
    )}
  </>
);

export interface FollowerListProps {
  followers: Actor[];
}

export const FollowerList: FC<FollowerListProps> = ({ followers }) => (
  <>
    <nav>
      <a href="/" class="secondary">
        ← Back
      </a>
    </nav>
    <h2>Followers</h2>
    {followers.length === 0 ? (
      <p>
        <small>No followers yet. Share your profile to get started!</small>
      </p>
    ) : (
      <div>
        <p>
          <small>
            {followers.length} follower{followers.length !== 1 ? "s" : ""}
          </small>
        </p>
        <ul>
          {followers
            .filter((follower) => follower != null) // Filter out any null/undefined actors
            .map((follower) => (
              <li key={follower.id}>
                <ActorLink actor={follower} />
              </li>
            ))}
        </ul>
      </div>
    )}
  </>
);

export interface FollowingListProps {
  following: Actor[];
}

export const FollowingList: FC<FollowingListProps> = ({ following }) => (
  <>
    <nav>
      <a href="/" class="secondary">
        ← Back
      </a>
    </nav>
    <h2>Following</h2>
    {following.length === 0 ? (
      <p>
        <small>
          Not following anyone yet. Find interesting accounts to follow!
        </small>
      </p>
    ) : (
      <div>
        <p>
          <small>{following.length} following</small>
        </p>
        <ul>
          {following
            .filter((actor) => actor != null) // Filter out any null/undefined actors
            .map((actor) => (
              <li key={actor.id}>
                <ActorLink actor={actor} />
              </li>
            ))}
        </ul>
      </div>
    )}
  </>
);

export interface ActorLinkProps {
  actor: Actor;
}

export const ActorLink: FC<ActorLinkProps> = ({ actor }) => {
  if (!actor) {
    return <span>Unknown user</span>;
  }

  let href: string;
  let isLocal = false;

  // Check if this is a local actor
  if (actor.user_id) {
    isLocal = true;
  } else if (actor.handle) {
    // Also check if the handle contains the local domain (gunac.ar)
    const handleDomain =
      actor.handle.split("@")[2] || actor.handle.split("@")[1];
    if (handleDomain === "gunac.ar" || handleDomain === "localhost:8000") {
      isLocal = true;
    }
  }

  if (isLocal) {
    // Local user - use actor.username if present, else fallback to handle segment
    let username = "";
    if (actor.username) {
      username = actor.username;
    } else if (actor.handle) {
      // Remove leading @ if present
      const handle = actor.handle.startsWith("@")
        ? actor.handle.slice(1)
        : actor.handle;
      // Username is the part before the first @, e.g. username in username@gunac.ar
      const parts = handle.split("@");
      username = parts[0];
    } else {
      username = "user";
    }
    href = `/@${username}`;
  } else {
    // Remote user - link to their external profile
    href = actor.url ?? actor.uri;
  }

  const handle = actor.handle;
  const name = actor.name;

  return name ? (
    <>
      <a href={href}>
        <strong>{name}</strong>
      </a>{" "}
      <small>
        (
        <a href={href} class="secondary">
          {handle}
        </a>
        )
      </small>
    </>
  ) : (
    <a href={href} class="secondary">
      {handle}
    </a>
  );
};

// Profile edit form
export const ProfileEditForm: FC<{ name: string; bio?: string }> = ({
  name,
  bio,
}) => (
  <>
    <h2>Edit Profile</h2>
    <form method="post" action="/profile/edit">
      <fieldset>
        <label>
          Name <input type="text" name="name" required value={name} />
        </label>
        <label>
          Bio{" "}
          <textarea
            name="bio"
            placeholder="Tell the fediverse about yourself..."
            maxlength={500}
            rows={3}
          >
            {bio || ""}
          </textarea>
        </label>
      </fieldset>
      <input type="submit" value="Update Profile" />
    </form>
  </>
);

// Utility to format date in ET
function formatET(date: Date | string | number) {
  return DateTime.fromJSDate(date instanceof Date ? date : new Date(date), {
    zone: "utc",
  })
    .setZone("America/New_York")
    .toFormat("yyyy-LL-dd HH:mm 'ET'");
}

// Add this helper function near the top of the file (after imports):
function replaceMentionsWithLinks(content: string): string {
  // Replace @username (local) and @user@domain (remote)
  return content.replace(
    /(^|\s)@(\w+)(@(\w+\.\w+))?/g,
    (match, space, username, _full, domain) => {
      if (domain) {
        // Remote mention: try to link to fediverse profile if possible
        const url = `https://${domain}/@${username}`;
        return `${space}<a href="${url}" class="u-url mention" rel="nofollow">@${username}@${domain}</a>`;
      } else {
        // Local mention
        return `${space}<a href="/@${username}" class="u-url mention">@${username}</a>`;
      }
    },
  );
}

// In PostList, PostPage, and any other component that renders a post timestamp, replace:
//   {post.created.toLocaleString()}
// with:
//   {formatET(post.created)}
