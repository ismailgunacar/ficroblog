import type { FC } from "hono/jsx";
import type { Actor, Post, User } from "./schema.ts";

export const Layout: FC = (props) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
      <meta name="color-scheme" content="light dark" />
      <title>Marco3 - Single User Microblog</title>
      {/* Load CSS with high priority to prevent layout shifts */}
      <link
        rel="stylesheet"
        href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css"
        media="all"
      />
      {/* Inline critical CSS to prevent layout shifts */}
      <style>
        {`
          /* Critical styles that match Pico CSS defaults to prevent size changes */
          :root {
            --font-size: 1rem;
            --line-height: 1.5;
            --border-radius: 0.25rem;
            --spacing: 1rem;
          }
          
          html {
            box-sizing: border-box;
            font-size: 100%;
            -webkit-text-size-adjust: 100%;
            -ms-text-size-adjust: 100%;
          }
          
          *, *::before, *::after {
            box-sizing: inherit;
          }
          
          body {
            font-family: system-ui, -apple-system, "Segoe UI", "Roboto", "Ubuntu", "Cantarell", "Noto Sans", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";
            font-size: var(--font-size);
            line-height: var(--line-height);
            margin: 0;
            padding: 0;
            -webkit-text-size-adjust: 100%;
            -ms-text-size-adjust: 100%;
          }
          
          .container, main.container {
            width: 100%;
            max-width: 1200px;
            margin: 0 auto;
            padding: var(--spacing);
            box-sizing: border-box;
          }
          
          /* Match Pico's default form element sizes without color overrides */
          input, button, select, textarea {
            font-family: inherit;
            font-size: inherit;
            line-height: inherit;
            margin: 0;
            padding: 0.75rem 1rem;
            border-radius: var(--border-radius);
            box-sizing: border-box;
          }
          
          button, input[type="submit"] {
            cursor: pointer;
            padding: 0.75rem 1.5rem;
          }
          
          h1, h2, h3 {
            margin: 0 0 1rem 0;
            font-weight: 600;
            line-height: 1.25;
          }
          
          h1 { font-size: 2rem; }
          h2 { font-size: 1.5rem; }
          
          p {
            margin: 0 0 1rem 0;
          }
          
          /* Prevent any size jumps during CSS transition */
          * {
            transition: none !important;
          }
        `}
      </style>
    </head>
    <body>
      <main class="container">{props.children}</main>
      
      {/* Prevent CSS size changes after external stylesheet loads */}
      <script dangerouslySetInnerHTML={{
        __html: `
          // Store initial element sizes to prevent changes
          document.addEventListener('DOMContentLoaded', function() {
            // Remove transition restrictions after initial load
            setTimeout(function() {
              var style = document.createElement('style');
              style.textContent = '* { transition: inherit !important; }';
              document.head.appendChild(style);
            }, 100);
          });
        `
      }} />
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
    <h1>Login to your microblog</h1>
    <form method="post" action="/login">
      <fieldset>
        <label>
          Username{" "}
          <input
            type="text"
            name="username"
            required
            maxlength={50}
          />
        </label>
        <label>
          Password{" "}
          <input
            type="password"
            name="password"
            required
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
}

export const Profile: FC<ProfileProps> = ({
  name,
  username,
  handle,
  bio,
  following,
  followers,
}) => (
  <>
    <hgroup>
      <h1>
        <a href={`/users/${username}`}>{name}</a>
      </h1>
      <p>
        <span style="user-select: all;">{handle}</span> &middot;{" "}
        <a href={`/users/${username}/following`}>{following} following</a>{" "}
        &middot;{" "}
        <a href={`/users/${username}/followers`}>
          {followers === 1 ? "1 follower" : `${followers} followers`}
        </a>
        {" "}&middot;{" "}
        <a href="/profile/edit">Edit Profile</a>
      </p>
      {bio && <p style="font-style: italic; margin-top: 0.5rem;">{bio}</p>}
    </hgroup>
  </>
);

export interface HomeProps extends PostListProps {
  user: User & Actor;
  isAuthenticated?: boolean;
}

export const Home: FC<HomeProps> = ({ user, posts, isAuthenticated = false }) => (
  <>
    {/* Profile header with bio */}
    <hgroup>
      <h1>
        <a href={`/users/${user.username}`}>{user.name}</a>
      </h1>
      <p>
        <span style="user-select: all;">{user.handle}</span>
        {isAuthenticated && (
          <>
            {" "}&middot;{" "}
            <a href="/profile/edit">Edit Profile</a>
            {" | "}
            <a href="/logout">Logout</a>
          </>
        )}
        {!isAuthenticated && (
          <>
            {" | "}
            <a href="/login">Login</a>
          </>
        )}
      </p>
      {user.summary && <p style="font-style: italic; margin-top: 0.5rem;">{user.summary}</p>}
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
    
    <PostList posts={posts} isAuthenticated={isAuthenticated} />
  </>
);

export interface PostListProps {
  posts: (Post & Actor)[];
  isAuthenticated?: boolean;
}

export const PostList: FC<PostListProps> = ({ posts, isAuthenticated = false }) => (
  <>
    {posts.map((post) => (
      <div key={post.id}>
        <PostView post={post} isAuthenticated={isAuthenticated} />
      </div>
    ))}
  </>
);

export interface PostViewProps {
  post: Post & Actor & {
    likesCount?: number;
    repostsCount?: number;
    isLikedByUser?: boolean;
    isRepostedByUser?: boolean;
  };
  isAuthenticated?: boolean;
}

export const PostView: FC<PostViewProps> = ({ post, isAuthenticated = false }) => {
  // Helper function to safely format timestamp
  const formatTimestamp = (timestamp: any): { iso: string; display: string } => {
    try {
      const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
      if (isNaN(date.getTime())) {
        return { iso: '', display: 'Invalid date' };
      }
      return {
        iso: date.toISOString(),
        display: date.toLocaleString()
      };
    } catch (error) {
      console.error('Error formatting timestamp:', error, 'Raw timestamp:', timestamp);
      return { iso: '', display: 'Invalid date' };
    }
  };

  const timestamp = formatTimestamp(post.created);

  const handleLike = async (e: Event) => {
    e.preventDefault();
    try {
      const response = await fetch(`/posts/${post.id}/like`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      if (response.ok) {
        // Reload the page to update the like status
        window.location.reload();
      }
    } catch (error) {
      console.error('Failed to like post:', error);
    }
  };

  const handleRepost = async (e: Event) => {
    e.preventDefault();
    try {
      const response = await fetch(`/posts/${post.id}/repost`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      if (response.ok) {
        // Reload the page to update the repost status
        window.location.reload();
      }
    } catch (error) {
      console.error('Failed to repost post:', error);
    }
  };

  return (
    <article>
      <header>
        <ActorLink actor={post} />
      </header>
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: */}
      <div dangerouslySetInnerHTML={{ __html: post.content }} />
      <footer>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <a href={post.url ?? post.uri}>
            <time datetime={timestamp.iso}>
              {timestamp.display}
            </time>
          </a>
          
          {isAuthenticated && (
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
              <button
                type="button"
                onClick={handleLike}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.25rem',
                  color: post.isLikedByUser ? 'red' : 'inherit'
                }}
                title={post.isLikedByUser ? 'Unlike' : 'Like'}
              >
                {post.isLikedByUser ? '❤️' : '🤍'} {post.likesCount || 0}
              </button>
              
              <button
                type="button"
                onClick={handleRepost}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.25rem',
                  color: post.isRepostedByUser ? 'green' : 'inherit'
                }}
                title={post.isRepostedByUser ? 'Unrepost' : 'Repost'}
              >
                {post.isRepostedByUser ? '🔁' : '🔄'} {post.repostsCount || 0}
              </button>
            </div>
          )}
          
          {!isAuthenticated && (
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', color: 'var(--muted-color)' }}>
              <span>🤍 {post.likesCount || 0}</span>
              <span>🔄 {post.repostsCount || 0}</span>
            </div>
          )}
        </div>
      </footer>
    </article>
  );
};

export interface PostPageProps extends ProfileProps, PostViewProps {}

export const PostPage: FC<PostPageProps> = (props) => (
  <>
    <Profile
      name={props.name}
      username={props.username}
      handle={props.handle}
      bio={props.bio}
      following={props.following}
      followers={props.followers}
    />
    <PostView post={props.post} />
  </>
);

export interface FollowerListProps {
  followers: Actor[];
}

export const FollowerList: FC<FollowerListProps> = ({ followers }) => (
  <>
    <h2>Followers</h2>
    <ul>
      {followers.map((follower) => (
        <li key={follower.id}>
          <ActorLink actor={follower} />
        </li>
      ))}
    </ul>
  </>
);

export interface FollowingListProps {
  following: Actor[];
}

export const FollowingList: FC<FollowingListProps> = ({ following }) => (
  <>
    <h2>Following</h2>
    <ul>
      {following.map((actor) => (
        <li key={actor.id}>
          <ActorLink actor={actor} />
        </li>
      ))}
    </ul>
  </>
);

export interface ActorLinkProps {
  actor: Actor;
}

export const ActorLink: FC<ActorLinkProps> = ({ actor }) => {
  const href = actor.url ?? actor.uri;
  return actor.name == null ? (
    <a href={href} class="secondary">
      {actor.handle}
    </a>
  ) : (
    <>
      <a href={href}>{actor.name}</a>{" "}
      <small>
        (
        <a href={href} class="secondary">
          {actor.handle}
        </a>
        )
      </small>
    </>
  );
};

// Profile edit form
export const ProfileEditForm: FC<{ name: string; bio?: string }> = ({ name, bio }) => {
  console.log('🎨 ProfileEditForm Debug:');
  console.log('   name prop:', name);
  console.log('   bio prop:', bio);
  console.log('   bio type:', typeof bio);
  console.log('   bio length:', bio?.length || 0);
  
  return (
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
};
