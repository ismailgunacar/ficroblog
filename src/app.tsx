import { federation } from "@fedify/fedify/x/hono";
import { getLogger } from "@logtape/logtape";
import { Hono } from "hono";
import { getDb } from "./db.js";
import fedi from "./federation.ts";
import {
  type Post,
  type User,
  createPost,
  createUser,
  followUser,
  getFollowers,
  getFollowing,
  getPostsByUser,
  getUser,
  verifyUser,
} from "./models.js";

const logger = getLogger("fongoblog6");

const app = new Hono();
app.use(federation(fedi, () => undefined));

// Layout component
const Layout = ({ children }: { children: unknown }) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="color-scheme" content="light dark" />
      <title>Microblog</title>
      <link
        rel="stylesheet"
        href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css"
      />
    </head>
    <body>
      <main class="container">{children}</main>
    </body>
  </html>
);

// Setup form component
const SetupForm = () => (
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
          <input type="password" name="password" required minlength={6} />
        </label>
      </fieldset>
      <input type="submit" value="Setup" />
    </form>
    <p>
      <a href="/login">Already have an account? Login</a>
    </p>
  </>
);

// Login form component
const LoginForm = () => (
  <>
    <h1>Login to your microblog</h1>
    <form method="post" action="/login">
      <fieldset>
        <label>
          Username <input type="text" name="username" required />
        </label>
        <label>
          Password <input type="password" name="password" required />
        </label>
      </fieldset>
      <input type="submit" value="Login" />
    </form>
    <p>
      <a href="/setup">Don't have an account? Set up your microblog</a>
    </p>
  </>
);

// Profile component
const Profile = ({
  name,
  username,
  handle,
  following,
  followers,
}: {
  name: string;
  username: string;
  handle: string;
  following: number;
  followers: number;
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
      </p>
    </hgroup>
  </>
);

// Post list component
const PostList = ({ posts }: { posts: Post[] }) => (
  <>
    <h2>Posts</h2>
    {posts.length === 0 ? (
      <p>No posts yet.</p>
    ) : (
      posts.map((post) => (
        <article key={post._id}>
          <header>
            <strong>{post.username}</strong>
          </header>
          <div>{post.content}</div>
          <footer>
            <time datetime={new Date(post.createdAt).toISOString()}>
              {new Date(post.createdAt).toLocaleDateString("en-US", {
                year: "numeric",
                month: "long",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </time>
          </footer>
        </article>
      ))
    )}
  </>
);

// Home component
const Home = ({ user, posts }: { user: User; posts: Post[] }) => (
  <>
    <hgroup>
      <h1>{user.name}'s microblog</h1>
      <p>
        <a href={`/users/${user.username}`}>{user.name}'s profile</a>
      </p>
    </hgroup>

    <div id="auth-forms" style="display: none;">
      <article>
        <header>
          <h3>Follow someone</h3>
        </header>
        <form method="post" action={`/users/${user.username}/following`}>
          <fieldset>
            <input
              type="text"
              name="actor"
              required={true}
              placeholder="Enter an actor handle (e.g., @johndoe@mastodon.com) or URI (e.g., https://mastodon.com/@johndoe)"
            />
            <input type="submit" value="Follow" />
          </fieldset>
        </form>
      </article>

      <article>
        <header>
          <h3>Create a post</h3>
        </header>
        <form method="post" action={`/users/${user.username}/posts`}>
          <fieldset>
            <label>
              <textarea
                name="content"
                required={true}
                placeholder="What's up?"
              />
            </label>
          </fieldset>
          <input type="submit" value="Post" />
        </form>
      </article>
    </div>

    <div id="login-section">
      <article>
        <header>
          <h3>Login to interact</h3>
        </header>
        <div id="login-form">
          <fieldset>
            <label>
              Username <input type="text" id="login-username" required />
            </label>
            <label>
              Password <input type="password" id="login-password" required />
            </label>
          </fieldset>
          <button type="button" onclick="handleLogin()">
            Login
          </button>
        </div>
        <p>
          <a href="/setup">Don't have an account? Set up your microblog</a>
        </p>
      </article>
    </div>

    <PostList posts={posts} />

    <script src="/auth.js" />
  </>
);

// Main routes
app.get("/", async (c) => {
  // Get the first user from the database instead of hardcoding "fedify"
  const db = await getDb();
  const user = (await db.collection("users").findOne({})) as User | null;

  if (!user) return c.redirect("/login");

  const posts = await getPostsByUser(user.username);
  return c.html(
    <Layout>
      <Home user={user} posts={posts} />
    </Layout>,
  );
});

app.get("/setup", (c) => {
  return c.html(
    <Layout>
      <SetupForm />
    </Layout>,
  );
});

app.post("/setup", async (c) => {
  const form = await c.req.formData();
  const username = form.get("username");
  if (typeof username !== "string" || !username.match(/^[a-z0-9_-]{1,50}$/)) {
    return c.redirect("/setup");
  }
  const name = form.get("name");
  if (typeof name !== "string" || name.trim() === "") {
    return c.redirect("/setup");
  }
  const password = form.get("password");
  if (typeof password !== "string" || password.length < 6) {
    return c.redirect("/setup");
  }

  await createUser(username, name, password);
  return c.redirect("/login");
});

app.get("/login", (c) => {
  return c.html(
    <Layout>
      <LoginForm />
    </Layout>,
  );
});

app.post("/login", async (c) => {
  const form = await c.req.formData();
  const username = form.get("username");
  const password = form.get("password");

  if (typeof username !== "string" || typeof password !== "string") {
    return c.redirect("/login");
  }

  const user = await verifyUser(username, password);
  if (!user) {
    return c.redirect("/login");
  }

  // For now, just redirect to the main page
  // In a real app, you'd set a session cookie here
  return c.redirect("/");
});

app.get("/users/:username", async (c) => {
  const username = c.req.param("username");
  const user = await getUser(username);
  if (!user) return c.notFound();

  const posts = await getPostsByUser(username);
  const followers = await getFollowers(username);
  const following = await getFollowing(username);

  return c.html(
    <Layout>
      <Profile
        name={user.name || user.username}
        username={user.username}
        handle={`@${user.username}@localhost:8000`}
        following={following.length}
        followers={followers.length}
      />
      <PostList posts={posts} />
    </Layout>,
  );
});

app.get("/users/:username/followers", async (c) => {
  const username = c.req.param("username");
  const user = await getUser(username);
  if (!user) return c.notFound();

  const followers = await getFollowers(username);
  const following = await getFollowing(username);

  return c.html(
    <Layout>
      <Profile
        name={user.name || user.username}
        username={user.username}
        handle={`@${user.username}@localhost:8000`}
        following={following.length}
        followers={followers.length}
      />
      <h2>Followers</h2>
      <ul>
        {followers.map((follower) => (
          <li key={follower}>
            <a href={`/users/${follower}`}>{follower}</a>
          </li>
        ))}
      </ul>
    </Layout>,
  );
});

app.get("/users/:username/following", async (c) => {
  const username = c.req.param("username");
  const user = await getUser(username);
  if (!user) return c.notFound();

  const followers = await getFollowers(username);
  const following = await getFollowing(username);

  return c.html(
    <Layout>
      <Profile
        name={user.name || user.username}
        username={user.username}
        handle={`@${user.username}@localhost:8000`}
        following={following.length}
        followers={followers.length}
      />
      <h2>Following</h2>
      <ul>
        {following.map((followed) => (
          <li key={followed}>
            <a href={`/users/${followed}`}>{followed}</a>
          </li>
        ))}
      </ul>
    </Layout>,
  );
});

app.post("/users/:username/posts", async (c) => {
  const username = c.req.param("username");
  const form = await c.req.formData();
  const content = form.get("content");

  if (typeof content !== "string" || content.trim() === "") {
    return c.redirect("/");
  }

  await createPost(username, content);
  return c.redirect("/");
});

app.post("/users/:username/following", async (c) => {
  const username = c.req.param("username");
  const form = await c.req.formData();
  const actor = form.get("actor");

  if (typeof actor !== "string" || actor.trim() === "") {
    return c.redirect("/");
  }

  // For now, just follow a local user
  const targetUsername = actor.replace(/^@/, "").split("@")[0];
  await followUser(username, targetUsername);
  return c.redirect("/");
});

// API endpoints for compatibility
app.post("/users", async (c) => {
  const { username, name, password } = await c.req.json();
  await createUser(username, name, password);
  return c.json({ ok: true });
});

app.post("/users/:username/follow", async (c) => {
  const { follower } = await c.req.json();
  const username = c.req.param("username");
  await followUser(follower, username);
  return c.json({ ok: true });
});

app.get("/users/:username/followers", async (c) => {
  const username = c.req.param("username");
  const followers = await getFollowers(username);
  return c.json({ followers });
});

app.get("/users/:username/following", async (c) => {
  const username = c.req.param("username");
  const following = await getFollowing(username);
  return c.json({ following });
});

app.post("/posts", async (c) => {
  const { username, content } = await c.req.json();
  const post = await createPost(username, content);
  return c.json(post);
});

app.get("/users/:username/posts", async (c) => {
  const username = c.req.param("username");
  const posts = await getPostsByUser(username);
  return c.json({ posts });
});

// Serve static files
app.get("/auth.js", (c) => {
  return c.text(
    `
    // Check if user is logged in on page load
    window.addEventListener('load', () => {
      checkAuthState();
    });

    function checkAuthState() {
      const isLoggedIn = localStorage.getItem('isLoggedIn') === 'true';
      const authForms = document.getElementById('auth-forms');
      const loginSection = document.getElementById('login-section');
      
      if (isLoggedIn) {
        authForms.style.display = 'block';
        loginSection.style.display = 'none';
      } else {
        authForms.style.display = 'none';
        loginSection.style.display = 'block';
      }
    }

    async function handleLogin() {
      const username = document.getElementById('login-username').value;
      const password = document.getElementById('login-password').value;
      
      if (!username || !password) {
        alert('Please enter both username and password');
        return;
      }

      try {
        const response = await fetch('/login', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: \`username=\${encodeURIComponent(username)}&password=\${encodeURIComponent(password)}\`
        });

        if (response.ok) {
          localStorage.setItem('isLoggedIn', 'true');
          localStorage.setItem('currentUser', username);
          checkAuthState();
          document.getElementById('login-form').reset();
        } else {
          alert('Login failed. Please check your credentials.');
        }
      } catch (error) {
        alert('Login failed. Please try again.');
      }
    }
  `,
    200,
    { "Content-Type": "application/javascript" },
  );
});

export default app;
