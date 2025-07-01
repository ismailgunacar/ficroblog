import type { FC } from "hono/jsx";
import type { IFollow, IPost, IUser } from "./models.ts";
import { Post } from "./models.ts";

export const Layout: FC = (props) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="color-scheme" content="light dark" />
      <title>Wendy Microblog</title>
      <link
        rel="stylesheet"
        href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css"
      />
    </head>
    <body>
      <main class="container">{props.children}</main>
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
    <h2>Follow someone</h2>
    <form method="post" action="/follow">
      <fieldset>
        <label>
          Handle{" "}
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
    <hgroup>
      <h1>
        <a href={`/users/${username}`}>{name}</a>
      </h1>
      <p>
        <span style="user-select: all;">{handle}</span> &middot;{" "}
        <a href={`/users/${username}/followers`}>
          {followers === 1 ? "1 follower" : `${followers} followers`}
        </a>{" "}
        &middot;{" "}
        <a href={`/users/${username}/following`}>
          {following === 1 ? "1 following" : `${following} following`}
        </a>
      </p>
    </hgroup>
  </>
);

export interface HomeProps {
  user: IUser;
  handle: string;
  followers: number;
  following: number;
}

export const Home: FC<HomeProps> = async ({
  user,
  handle,
  followers,
  following,
}) => {
  const posts = await Post.find().sort({ createdAt: -1 }).exec();
  return (
    <>
      {/* Top Auth Card */}
      <article class="card" style={{ padding: "1rem", marginBottom: "1.5rem" }}>
        {/* TODO: Replace with real auth logic */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span>
            You are signed in as <strong>{user.displayName}</strong>
          </span>
          {/* <a href="/logout">Sign out</a> */}
        </div>
      </article>

      {/* Heading Card */}
      <article class="card" style={{ padding: "1rem", marginBottom: "1.5rem" }}>
        <hgroup>
          <h1>{user.displayName}'s microblog</h1>
          <p>
            <span style={{ userSelect: "all" }}>{handle}</span> &middot;{" "}
            <a href={`/users/${user.username}/followers`}>
              {followers === 1 ? "1 follower" : `${followers} followers`}
            </a>{" "}
            &middot;{" "}
            <a href={`/users/${user.username}/following`}>
              {following === 1 ? "1 following" : `${following} following`}
            </a>
          </p>
        </hgroup>
      </article>

      {/* Follow Someone Card */}
      <article class="card" style={{ padding: "1rem", marginBottom: "1.5rem" }}>
        <FollowForm />
      </article>

      {/* New Post Card */}
      <article class="card" style={{ padding: "1rem", marginBottom: "1.5rem" }}>
        <form method="post" action={`/users/${user.username}/posts`}>
          <fieldset>
            <label>
              <textarea name="content" required placeholder="What's up?" />
            </label>
          </fieldset>
          <input type="submit" value="Post" />
        </form>
      </article>

      {/* Timeline Section (posts already in cards) */}
      <section>
        <h2>Timeline</h2>
        <ul style={{ listStyle: "none", padding: 0 }}>
          {posts.map((post) => (
            <li key={post._id} style={{ marginBottom: "1.5rem" }}>
              <article class="card" style={{ padding: "1rem" }}>
                <strong>
                  {post.remote && post.author.startsWith("http") ? (
                    <a
                      href={post.author}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {post.author}
                    </a>
                  ) : (
                    post.author
                  )}
                </strong>
                {/* biome-ignore lint/security/noDangerouslySetInnerHtml: Post content is sanitized */}
                <div dangerouslySetInnerHTML={{ __html: post.content }} />
                <div
                  style={{
                    fontSize: "0.9em",
                    color: "#666",
                    marginTop: "0.5rem",
                  }}
                >
                  <time dateTime={new Date(post.createdAt).toISOString()}>
                    {new Date(post.createdAt).toLocaleString()}
                  </time>
                  {!post.remote && (
                    <>
                      {" "}
                      &middot;{" "}
                      <a
                        href={`/users/${post.author}/posts/${post._id}`}
                        class="secondary"
                      >
                        permalink
                      </a>
                    </>
                  )}
                </div>
              </article>
            </li>
          ))}
        </ul>
      </section>
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
