export function renderLikeButton(postId: string, likeCount: number = 0, isLiked: boolean = false) {
  return `
    <button 
      onclick="toggleLike('${postId}')"
      onmouseenter="showLikesOnHover('${postId}')"
      onmouseleave="hideLikesTooltip('${postId}')"
      style="background: none; border: none; cursor: pointer; margin-right: 10px;"
      data-liked="${isLiked}"
      data-like-count="${likeCount}"
    >
      ${isLiked ? '❤️' : '🤍'} ${likeCount}
    </button>
  `;
}

export function renderAnnounceButton(postId: string, announceCount: number = 0, isAnnounced: boolean = false) {
  return `
    <button 
      onclick="toggleAnnounce('${postId}')"
      onmouseenter="showAnnouncesOnHover('${postId}')"
      onmouseleave="hideAnnouncesTooltip('${postId}')"
      style="background: none; border: none; cursor: pointer; margin-right: 10px;"
      data-announced="${isAnnounced}"
      data-announce-count="${announceCount}"
    >
      ${isAnnounced ? '🔄' : '⚪'} ${announceCount}
    </button>
  `;
}

export function renderPostActions(postId: string, likeCount: number = 0, announceCount: number = 0, isLiked: boolean = false, isAnnounced: boolean = false) {
  return `
    <div class="post-actions" style="margin-top: 10px;">
      ${renderLikeButton(postId, likeCount, isLiked)}
      ${renderAnnounceButton(postId, announceCount, isAnnounced)}
    </div>
  `;
}
