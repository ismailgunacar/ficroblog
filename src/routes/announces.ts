import { Hono } from 'hono';
import { ObjectId } from 'mongodb';
import { getAnnouncesCollection, getPostsCollection } from '../db.js';
import { getDomainFromRequest, getBaseUrlFromRequest } from '../utils/domain.js';
import { createAnnounceActivity, createUndoActivity, federateActivity, isLocalActor } from '../utils/federation.js';
import { getCurrentUser, getDefaultUser } from '../utils/session.js';
import type { Announce } from '../models/announce.js';

const announcesRoutes = new Hono();

// Announce/boost a post
announcesRoutes.post('/post/:postId/announce', async (c) => {
  const postId = c.req.param('postId');
  const announces = getAnnouncesCollection();
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

    // Check if already announced
    const existingAnnounce = await announces.findOne({ 
      actorId, 
      objectId: postId 
    });
    
    if (existingAnnounce) {
      // Un-announce - remove the announce
      await announces.deleteOne({ _id: existingAnnounce._id });
      
      // If this was a federated announce, send Undo activity
      if (existingAnnounce.activityId && !isLocalActor(post.authorId || '', domain)) {
        try {
          const originalActivity = createAnnounceActivity(actorId, postId, domain);
          originalActivity.id = existingAnnounce.activityId;
          
          const undoActivity = createUndoActivity(actorId, originalActivity, domain);
          
          // Find remote actors to notify (post author for now)
          const remoteActors = [];
          if (post.authorId && !isLocalActor(post.authorId, domain)) {
            remoteActors.push(post.authorId);
          }
          
          if (remoteActors.length > 0) {
            // Fire and forget federation
            federateActivity(undoActivity, remoteActors).catch(error => {
              console.error('Federation error for undo announce:', error);
            });
          }
        } catch (federationError) {
          console.error('Error creating undo activity:', federationError);
        }
      }
      
      // Get updated count
      const announceCount = await announces.countDocuments({ objectId: postId });
      
      return c.json({
        success: true,
        announced: false,
        announceCount
      });
    } else {
      // Announce - add the announce
      const announceActivity = createAnnounceActivity(actorId, postId, domain);
      
      const announce: Announce = {
        actorId,
        objectId: postId,
        activityId: announceActivity.id,
        createdAt: new Date(),
        actorUsername: user.username,
        actorDisplayName: user.displayName,
      };
      
      await announces.insertOne(announce);
      
      // If this is a remote post, send Announce activity
      if (post.authorId && !isLocalActor(post.authorId, domain)) {
        try {
          // Find remote actors to notify (post author for now)
          const remoteActors = [post.authorId];
          
          // Fire and forget federation
          federateActivity(announceActivity, remoteActors).catch(error => {
            console.error('Federation error for announce:', error);
          });
        } catch (federationError) {
          console.error('Error federating announce activity:', federationError);
        }
      }
      
      // Get updated count
      const announceCount = await announces.countDocuments({ objectId: postId });
      
      return c.json({
        success: true,
        announced: true,
        announceCount
      });
    }
  } catch (error) {
    console.error('Error toggling announce:', error);
    return c.json({ success: false, error: 'Failed to toggle announce' }, 500);
  }
});

// Get announces for a post (for displaying who announced)
announcesRoutes.get('/post/:postId/announces', async (c) => {
  const postId = c.req.param('postId');
  const announces = getAnnouncesCollection();
  
  try {
    const announcesList = await announces.find({ objectId: postId }).toArray();
    return c.json({
      success: true,
      announces: announcesList.map(announce => ({
        actorUsername: announce.actorUsername,
        actorDisplayName: announce.actorDisplayName,
        createdAt: announce.createdAt
      }))
    });
  } catch (error) {
    console.error('Error fetching announces:', error);
    return c.json({ success: false, error: 'Failed to fetch announces' }, 500);
  }
});

export default announcesRoutes;
