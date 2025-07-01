// Like functionality with hover display
window.toggleLike = async function(postId) {
  const button = document.querySelector(`button[onclick="toggleLike('${postId}')"]`);
  if (!button) return;
  
  try {
    const response = await fetch(`/post/${postId}/like`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    
    if (response.ok) {
      const data = await response.json();
      const icon = data.liked ? '❤️' : '🤍';
      button.innerHTML = `${icon} ${data.likeCount || 0}`;
      
      // Update the button's data attributes for hover display
      button.setAttribute('data-liked', data.liked);
      button.setAttribute('data-like-count', data.likeCount || 0);
    }
  } catch (error) {
    console.error('Error toggling like:', error);
  }
};

// Announce functionality with hover display
window.toggleAnnounce = async function(postId) {
  const button = document.querySelector(`button[onclick="toggleAnnounce('${postId}')"]`);
  if (!button) return;
  
  try {
    const response = await fetch(`/post/${postId}/announce`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    
    if (response.ok) {
      const data = await response.json();
      const icon = data.announced ? '🔄' : '⚪';
      button.innerHTML = `${icon} ${data.announceCount || 0}`;
      
      // Update the button's data attributes for hover display
      button.setAttribute('data-announced', data.announced);
      button.setAttribute('data-announce-count', data.announceCount || 0);
    }
  } catch (error) {
    console.error('Error toggling announce:', error);
  }
};

// Show who liked a post on hover
window.showLikesOnHover = function(postId) {
  const button = document.querySelector(`button[onclick="toggleLike('${postId}')"]`);
  if (!button) return;
  
  // Create tooltip if it doesn't exist
  let tooltip = document.getElementById(`likes-tooltip-${postId}`);
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.id = `likes-tooltip-${postId}`;
    tooltip.className = 'likes-tooltip';
    tooltip.style.cssText = `
      position: absolute;
      background: #333;
      color: white;
      padding: 8px;
      border-radius: 4px;
      font-size: 12px;
      z-index: 1000;
      max-width: 200px;
      display: none;
      pointer-events: none;
    `;
    document.body.appendChild(tooltip);
  }
  
  // Position tooltip
  const rect = button.getBoundingClientRect();
  tooltip.style.left = rect.left + 'px';
  tooltip.style.top = (rect.top - 40) + 'px';
  tooltip.style.display = 'block';
  tooltip.innerHTML = 'Loading likes...';
  
  // Fetch and display likes
  fetch(`/post/${postId}/likes`)
    .then(response => response.json())
    .then(data => {
      if (data.success && data.likes.length > 0) {
        const likesList = data.likes.map(like => 
          like.actorDisplayName || like.actorUsername || 'Unknown user'
        ).join(', ');
        tooltip.innerHTML = `Liked by: ${likesList}`;
      } else {
        tooltip.innerHTML = 'No likes yet';
      }
    })
    .catch(error => {
      console.error('Error fetching likes:', error);
      tooltip.innerHTML = 'Error loading likes';
    });
};

// Show who announced a post on hover
window.showAnnouncesOnHover = function(postId) {
  const button = document.querySelector(`button[onclick="toggleAnnounce('${postId}')"]`);
  if (!button) return;
  
  // Create tooltip if it doesn't exist
  let tooltip = document.getElementById(`announces-tooltip-${postId}`);
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.id = `announces-tooltip-${postId}`;
    tooltip.className = 'announces-tooltip';
    tooltip.style.cssText = `
      position: absolute;
      background: #333;
      color: white;
      padding: 8px;
      border-radius: 4px;
      font-size: 12px;
      z-index: 1000;
      max-width: 200px;
      display: none;
      pointer-events: none;
    `;
    document.body.appendChild(tooltip);
  }
  
  // Position tooltip
  const rect = button.getBoundingClientRect();
  tooltip.style.left = rect.left + 'px';
  tooltip.style.top = (rect.top - 40) + 'px';
  tooltip.style.display = 'block';
  tooltip.innerHTML = 'Loading announces...';
  
  // Fetch and display announces
  fetch(`/post/${postId}/announces`)
    .then(response => response.json())
    .then(data => {
      if (data.success && data.announces.length > 0) {
        const announcesList = data.announces.map(announce => 
          announce.actorDisplayName || announce.actorUsername || 'Unknown user'
        ).join(', ');
        tooltip.innerHTML = `Announced by: ${announcesList}`;
      } else {
        tooltip.innerHTML = 'No announces yet';
      }
    })
    .catch(error => {
      console.error('Error fetching announces:', error);
      tooltip.innerHTML = 'Error loading announces';
    });
};

// Hide tooltips
window.hideLikesTooltip = function(postId) {
  const tooltip = document.getElementById(`likes-tooltip-${postId}`);
  if (tooltip) {
    tooltip.style.display = 'none';
  }
};

window.hideAnnouncesTooltip = function(postId) {
  const tooltip = document.getElementById(`announces-tooltip-${postId}`);
  if (tooltip) {
    tooltip.style.display = 'none';
  }
};
