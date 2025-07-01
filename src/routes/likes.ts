import { Hono } from 'hono';
import { ObjectId } from 'mongodb';
import { getLikesCollection, getPostsCollection, getUsersCollection } from '../db.js';
import { getDomainFromRequest, getBaseUrlFromRequest } from '../utils/domain.js';
import { createLikeActivity, createUndoActivity, federateActivity, isLocalActor } from '../utils/federation.js';
import { getCurrentUser, getDefaultUser } from '../utils/session.js';
import type { Like } from '../models/like.js';

const likesRoutes = new Hono();

// Like a post
likesRoutes.post('/post/:postId/like', async (c) => {
  const postId = c.req.param('postId');
  const likes = getLikesCollection();
  const posts = getPostsCollection();
  const domain = getDomainFromRequest(c);
  const baseUrl = getBaseUrlFromRequest(c);
  
  // Get current user (for development, use default user)
  const user = getCurrentUser(c) || getDefaultUser();
  const actorId = `${baseUrl}/users/${user.username}`;
  
  try {
    // Get the post to check if it exists and get author info
    const post = await posts.findOne({ _id: new ObjectId(postId) });
    if (!post) {
      return c.json({ success: false, error: 'Post not found' }, 404);
    }

    // Check if already liked
    const existingLike = await likes.findOne({ 
      actorId, 
      objectId: postId 
    });
    
    if (existingLike) {
      // Unlike - remove the like
      await likes.deleteOne({ _id: existingLike._id });
      
      // If this was a federated like, send Undo activity
      if (existingLike.activityId && !isLocalActor(post.authorId || '', domain)) {
        try {
          const originalActivity = createLikeActivity(actorId, postId, domain);
          originalActivity.id = existingLike.activityId;
          
          const undoActivity = createUndoActivity(actorId, originalActivity, domain);
          
          // Find remote actors to notify (post author for now)
          const remoteActors = [];
          if (post.authorId && !isLocalActor(post.authorId, domain)) {
            remoteActors.push(post.authorId);
          }
          
          if (remoteActors.length > 0) {
            // Fire and forget federation
            federateActivity(undoActivity, remoteActors).catch(error => {
              console.error('Federation error for undo like:', error);
            });
          }
        } catch (federationError) {
          console.error('Error creating undo activity:', federationError);
        }
      }
      
      // Get updated count
      const likeCount = await likes.countDocuments({ objectId: postId });
      
      return c.json({
        success: true,
        liked: false,
        likeCount
      });
    } else {
      // Like - add the like
      const likeActivity = createLikeActivity(actorId, postId, domain);
      
      const like: Like = {
        actorId,
        objectId: postId,
        activityId: likeActivity.id,
        createdAt: new Date(),
        actorUsername: user.username,
        actorDisplayName: user.displayName,
      };
      
      await likes.insertOne(like);
      
      // If this is a remote post, send Like activity
      if (post.authorId && !isLocalActor(post.authorId, domain)) {
        try {
          // Find remote actors to notify (post author for now)
          const remoteActors = [post.authorId];
          
          // Fire and forget federation
          federateActivity(likeActivity, remoteActors).catch(error => {
            console.error('Federation error for like:', error);
          });
        } catch (federationError) {
          console.error('Error federating like activity:', federationError);
        }
      }
      
      // Get updated count
      const likeCount = await likes.countDocuments({ objectId: postId });
      
      return c.json({
        success: true,
        liked: true,
        likeCount
      });
    }
  } catch (error) {
    console.error('Error toggling like:', error);
    return c.json({ success: false, error: 'Failed to toggle like' }, 500);
  }
});

// Get likes for a post (for displaying who liked)
likesRoutes.get('/post/:postId/likes', async (c) => {
  const postId = c.req.param('postId');
  const likes = getLikesCollection();
  
  try {
    const likesList = await likes.find({ objectId: postId }).toArray();
    return c.json({
      success: true,
      likes: likesList.map(like => ({
        actorUsername: like.actorUsername,
        actorDisplayName: like.actorDisplayName,
        createdAt: like.createdAt
      }))
    });
  } catch (error) {
    console.error('Error fetching likes:', error);
    return c.json({ success: false, error: 'Failed to fetch likes' }, 500);
  }
});

export default likesRoutes;
