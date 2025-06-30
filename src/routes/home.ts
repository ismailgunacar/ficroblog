import { Hono } from "hono";
import { MongoClient, ObjectId } from "mongodb";
import { verifyPassword } from "../auth";
import type { Post, User } from "../models";
import { getSessionUser, setSessionCookie } from "../session";
import { getDomainAndProtocolFromRequest } from "../utils/domain";
import { renderHome } from "../views/home";

export function createHomeRoutes(client: MongoClient) {
	const app = new Hono();

	// Homepage: show timeline and post form
	app.get("/", async (c) => {
		await client.connect();
		const db = client.db();
		const { protocol, domain } = getDomainAndProtocolFromRequest(c);

		console.log("=== HOME PAGE REQUEST ===");
		console.log("Domain:", domain);

		// Get current user from session
		const currentUser = await getSessionUser(c, db);
		const loggedIn = !!currentUser;

		console.log("User from session:", currentUser?.username || "none");

		// Get or create default user if none exists
		let user = currentUser;
		if (!user) {
			user = await db.collection<User>("users").findOne();
			if (!user) {
				console.log("No users found, redirecting to setup");
				return c.redirect("/setup");
			}
		}

		// Get user stats
		const postCount = await db
			.collection("posts")
			.countDocuments({ userId: user._id });
		const followerCount = await db
			.collection("follows")
			.countDocuments({ followingId: user._id });
		const followingCount = await db
			.collection("follows")
			.countDocuments({ followerId: user._id });

		// Get all posts for timeline (recent first)
		const allPosts = await db
			.collection<Post>("posts")
			.find()
			.sort({ createdAt: -1 })
			.limit(50)
			.toArray();

		// Get all users for mapping
		const allUsers = await db.collection<User>("users").find().toArray();
		const userMap = new Map(allUsers.map((u) => [u._id.toString(), u]));

		console.log(`Found ${allPosts.length} posts for timeline`);

		// Check if this is an AJAX request
		const isAjax = c.req.header("X-Requested-With") === "fetch";
		const acceptsJson = c.req.header("Accept")?.includes("application/json");

		const html = renderHome({
			user,
			postCount,
			followerCount,
			followingCount,
			allPosts,
			userMap,
			loggedIn,
			invalidPassword: false,
			domain,
		});

		if (isAjax && acceptsJson) {
			return c.json({ success: true, html });
		}

		return c.html(html);
	});

	// Handle login and post creation
	app.post("/", async (c) => {
		await client.connect();
		const db = client.db();
		const { protocol, domain } = getDomainAndProtocolFromRequest(c);

		console.log("=== HOME POST REQUEST ===");

		const formData = await c.req.formData();
		const password = formData.get("password")?.toString();
		const content = formData.get("content")?.toString();

		console.log(
			"Form data - password exists:",
			!!password,
			"content exists:",
			!!content,
		);

		// Handle login attempt
		if (password) {
			console.log("Processing login attempt");
			const user = await db.collection<User>("users").findOne();

			if (user && (await verifyPassword(password, user.passwordHash))) {
				console.log("Login successful for user:", user.username);
				setSessionCookie(c, user._id.toString());

				// Return success response for AJAX requests
				const isAjax = c.req.header("X-Requested-With") === "fetch";
				if (isAjax) {
					const html = await generateHomeHTML(db, user, domain, true, false);
					return c.json({ success: true, html });
				}

				return c.redirect("/");
			} else {
				console.log("Login failed - invalid password");

				// Get default user for display
				const displayUser = await db.collection<User>("users").findOne();
				const isAjax = c.req.header("X-Requested-With") === "fetch";

				if (isAjax) {
					const html = await generateHomeHTML(
						db,
						displayUser,
						domain,
						false,
						true,
					);
					return c.json({ success: false, html });
				}

				// Fallback for non-AJAX requests
				return c.redirect("/?error=invalid_password");
			}
		}

		// Handle post creation
		if (content) {
			console.log("Processing post creation");
			const currentUser = await getSessionUser(c, db);

			if (!currentUser) {
				console.log("User not logged in, cannot create post");
				return c.redirect("/");
			}

			console.log("Creating post for user:", currentUser.username);

			const post: Post = {
				_id: new ObjectId(),
				userId: currentUser._id,
				content: content.trim(),
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			await db.collection("posts").insertOne(post);
			console.log("Post created successfully");

			return c.redirect("/");
		}

		console.log("No valid form data, redirecting to home");
		return c.redirect("/");
	});

	return app;
}

async function generateHomeHTML(
	db: any,
	user: User | null,
	domain: string,
	loggedIn: boolean,
	invalidPassword: boolean,
): Promise<string> {
	if (!user) {
		user = await db.collection<User>("users").findOne();
	}

	const postCount = user
		? await db.collection("posts").countDocuments({ userId: user._id })
		: 0;
	const followerCount = user
		? await db.collection("follows").countDocuments({ followingId: user._id })
		: 0;
	const followingCount = user
		? await db.collection("follows").countDocuments({ followerId: user._id })
		: 0;

	const allPosts = await db
		.collection<Post>("posts")
		.find()
		.sort({ createdAt: -1 })
		.limit(50)
		.toArray();

	const allUsers = await db.collection<User>("users").find().toArray();
	const userMap = new Map(allUsers.map((u: User) => [u._id.toString(), u]));

	return renderHome({
		user,
		postCount,
		followerCount,
		followingCount,
		allPosts,
		userMap,
		loggedIn,
		invalidPassword,
		domain,
	});
}
