// Client-side JavaScript handlers
// This will be compiled and served as a static asset

export function attachHandlers(domain: string) {
  // Profile editing handlers
  function setupProfileHandlers() {
    const loggedIn = !!document.getElementById('logout-btn');
    
    if (loggedIn) {
      setupLoggedInHandlers(domain);
    } else {
      setupLoginHandlers();
    }
  }

  function setupLoggedInHandlers(domain: string) {
    const editBtn = document.getElementById('edit-profile-btn');
    const saveBtn = document.getElementById('save-profile-btn');
    const cancelBtn = document.getElementById('cancel-profile-btn');
    const msg = document.getElementById('profile-msg');
    const fields = [
      ['profile-name', 'edit-name'],
      ['profile-username', 'edit-username'],
      ['profile-bio', 'edit-bio'],
      ['avatar-img', 'edit-avatarUrl'],
      ['header-img', 'edit-headerUrl']
    ];

    if (editBtn && saveBtn) {
      editBtn.onclick = () => enterEditMode(fields, editBtn, saveBtn, cancelBtn);
      saveBtn.onclick = () => saveProfile(fields, editBtn, saveBtn, cancelBtn, msg, domain);
      cancelBtn.onclick = () => cancelEdit(fields, editBtn, saveBtn, cancelBtn, msg, domain);
    }

    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
      logoutBtn.onclick = handleLogout;
    }
  }

  function setupLoginHandlers() {
    const loginToggle = document.getElementById('login-toggle');
    const loginForm = document.getElementById('inline-login');
    const passwordInput = document.getElementById('login-password');
    
    if (loginToggle && loginForm && passwordInput) {
      loginToggle.onclick = () => handleLoginToggle(passwordInput);
      passwordInput.onkeydown = (e) => {
        if (e.key === 'Enter' && passwordInput.value.trim() !== '') {
          doLogin(loginForm);
        }
      };
    }
  }

  function enterEditMode(fields: string[][], editBtn: HTMLElement, saveBtn: HTMLElement, cancelBtn: HTMLElement) {
    const profileInfo = document.querySelector('.profile-info');
    if (profileInfo) profileInfo.classList.add('editing');
    
    fields.forEach(([view, edit]) => {
      const v = document.getElementById(view);
      const e = document.getElementById(edit);
      if (v) v.style.display = 'none';
      if (e) e.style.display = '';
    });
    
    editBtn.style.display = 'none';
    saveBtn.style.display = '';
    cancelBtn.style.display = '';
  }

  async function saveProfile(fields: string[][], editBtn: HTMLElement, saveBtn: HTMLElement, cancelBtn: HTMLElement, msg: HTMLElement, domain: string) {
    const name = (document.getElementById('edit-name') as HTMLInputElement).value;
    const username = (document.getElementById('edit-username') as HTMLInputElement).value;
    const bio = (document.getElementById('edit-bio') as HTMLTextAreaElement).value;
    const avatarUrl = (document.getElementById('edit-avatarUrl') as HTMLInputElement).value;
    const headerUrl = (document.getElementById('edit-headerUrl') as HTMLInputElement).value;
    
    try {
      const res = await fetch('/profile/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, username, bio, avatarUrl, headerUrl })
      });
      
      if (res.ok) {
        updateProfileDisplay(name, username, bio, avatarUrl, headerUrl, domain);
        exitEditMode(fields, editBtn, saveBtn, cancelBtn, msg);
        msg.textContent = 'Saved!';
        setTimeout(() => msg.textContent = '', 2000);
      } else {
        msg.textContent = 'Error saving profile.';
        msg.style.color = '#c00';
      }
    } catch (error) {
      console.error('Save profile error:', error);
      msg.textContent = 'Network error. Please try again.';
      msg.style.color = '#c00';
    }
  }

  function cancelEdit(fields: string[][], editBtn: HTMLElement, saveBtn: HTMLElement, cancelBtn: HTMLElement, msg: HTMLElement, domain: string) {
    // Revert form fields back to original values
    (document.getElementById('edit-name') as HTMLInputElement).value = document.getElementById('profile-name')!.textContent || '';
    (document.getElementById('edit-username') as HTMLInputElement).value = document.getElementById('profile-username')!.textContent!.replace('@' + domain, '').replace('@', '');
    (document.getElementById('edit-bio') as HTMLTextAreaElement).value = document.getElementById('profile-bio')!.textContent || '';
    (document.getElementById('edit-avatarUrl') as HTMLInputElement).value = (document.getElementById('avatar-img') as HTMLImageElement).src;
    (document.getElementById('edit-headerUrl') as HTMLInputElement).value = (document.getElementById('header-img') as HTMLImageElement).src;
    
    exitEditMode(fields, editBtn, saveBtn, cancelBtn, msg);
  }

  function exitEditMode(fields: string[][], editBtn: HTMLElement, saveBtn: HTMLElement, cancelBtn: HTMLElement, msg: HTMLElement) {
    fields.forEach(([view, edit]) => {
      const v = document.getElementById(view);
      const e = document.getElementById(edit);
      if (v) v.style.display = '';
      if (e) e.style.display = 'none';
    });
    
    editBtn.style.display = '';
    saveBtn.style.display = 'none';
    cancelBtn.style.display = 'none';
    msg.textContent = '';
    
    const profileInfo = document.querySelector('.profile-info');
    if (profileInfo) profileInfo.classList.remove('editing');
  }

  function updateProfileDisplay(name: string, username: string, bio: string, avatarUrl: string, headerUrl: string, domain: string) {
    document.getElementById('profile-name')!.textContent = name;
    document.getElementById('profile-username')!.textContent = '@' + username + '@' + domain;
    document.getElementById('profile-bio')!.textContent = bio;
    
    const avatarImg = document.getElementById('avatar-img') as HTMLImageElement;
    avatarImg.src = avatarUrl;
    avatarImg.style.display = avatarUrl ? '' : 'none';
    
    const headerImg = document.getElementById('header-img') as HTMLImageElement;
    headerImg.src = headerUrl;
    headerImg.style.display = headerUrl ? '' : 'none';
  }

  async function handleLogout(e: Event) {
    e.preventDefault();
    try {
      await fetch('/logout', { method: 'POST' });
      const res = await fetch('/', { 
        headers: { 
          'X-Requested-With': 'fetch', 
          'Accept': 'application/json' 
        } 
      });
      
      if (res.ok) {
        const data = await res.json();
        setBodyFromHTML(data.html);
      } else {
        window.location.reload();
      }
    } catch (error) {
      console.error('Logout error:', error);
      window.location.reload();
    }
  }

  function handleLoginToggle(passwordInput: HTMLInputElement) {
    if (passwordInput.style.display === 'none' || passwordInput.style.display === '') {
      passwordInput.style.display = 'block';
      passwordInput.focus();
    } else if (passwordInput.value.trim() === '') {
      passwordInput.style.display = 'none';
      passwordInput.value = '';
    } else {
      doLogin(passwordInput.form as HTMLFormElement);
    }
  }

  async function doLogin(form: HTMLFormElement) {
    const formData = new FormData(form);
    
    try {
      const res = await fetch('/', {
        method: 'POST',
        headers: { 
          'X-Requested-With': 'fetch',
          'Accept': 'application/json'
        },
        body: formData
      });
      
      const contentType = res.headers.get('content-type') || '';
      
      if (contentType.includes('application/json')) {
        const data = await res.json();
        if (data.success) {
          setBodyFromHTML(data.html);
        } else {
          setProfileCardFromHTML(data.html);
        }
      } else {
        const html = await res.text();
        setBodyFromHTML(html);
      }
    } catch (error) {
      console.error('Login error:', error);
      window.location.reload();
    }
  }

  // DOM manipulation utilities
  function setBodyFromHTML(html: string) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    document.body.innerHTML = doc.body.innerHTML;
    
    // Remove any accidentally injected handler script tags from body
    const scripts = document.body.querySelectorAll('script[data-main-handlers]');
    scripts.forEach(s => s.remove());
    
    // Re-attach handlers
    reattachHandlers();
  }

  function setProfileCardFromHTML(html: string) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const newProfileCard = doc.getElementById('profile-card');
    
    if (newProfileCard) {
      const currentProfileCard = document.getElementById('profile-card');
      if (currentProfileCard) {
        currentProfileCard.outerHTML = newProfileCard.outerHTML;
      }
    }
    
    reattachHandlers();
  }

  function reattachHandlers() {
    if (typeof window.attachHandlers === 'function') {
      window.attachHandlers();
    }
  }

  // Initialize handlers
  setupProfileHandlers();
}

// Post interaction handlers
export async function toggleLike(postId: string) {
  const button = document.querySelector(`button[onclick="toggleLike('${postId}')"]`) as HTMLButtonElement;
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
    }
  } catch (error) {
    console.error('Error toggling like:', error);
  }
}

export async function toggleRepost(postId: string) {
  const button = document.querySelector(`button[onclick="toggleRepost('${postId}')"]`) as HTMLButtonElement;
  if (!button) return;
  
  try {
    const response = await fetch(`/post/${postId}/repost`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    
    if (response.ok) {
      const data = await response.json();
      const icon = data.reposted ? '🔄' : '⚪';
      button.innerHTML = `${icon} ${data.repostCount || 0}`;
    }
  } catch (error) {
    console.error('Error toggling repost:', error);
  }
}

export function showReplyForm(postId: string) {
  const replyForm = document.getElementById(`reply-form-${postId}`);
  if (replyForm) {
    replyForm.style.display = 'block';
    const textarea = replyForm.querySelector('input[name="content"]') as HTMLInputElement;
    if (textarea) {
      textarea.focus();
    }
  }
}

export function hideReplyForm(postId: string) {
  const replyForm = document.getElementById(`reply-form-${postId}`);
  if (replyForm) {
    replyForm.style.display = 'none';
    const textarea = replyForm.querySelector('input[name="content"]') as HTMLInputElement;
    if (textarea) {
      textarea.value = '';
    }
  }
}

export async function handleRemoteFollow(event: Event) {
  event.preventDefault();
  
  const form = event.target as HTMLFormElement;
  const formData = new FormData(form);
  const remoteUser = formData.get('remoteUser');
  const msgDiv = document.getElementById('remote-follow-msg');
  
  if (!remoteUser || !remoteUser.toString().includes('@')) {
    if (msgDiv) {
      msgDiv.innerHTML = '<small style="color: #c00;">Please enter a valid username@domain format</small>';
    }
    return;
  }
  
  try {
    const response = await fetch('/remote-follow', {
      method: 'POST',
      body: formData
    });
    
    const data = await response.json();
    
    if (data.success) {
      if (msgDiv) {
        msgDiv.innerHTML = `<small style="color: #090;">✅ ${data.message}</small>`;
      }
      form.reset();
      setTimeout(() => {
        window.location.reload();
      }, 2000);
    } else {
      if (msgDiv) {
        msgDiv.innerHTML = `<small style="color: #c00;">❌ ${data.error}</small>`;
      }
    }
  } catch (error) {
    console.error('Remote follow error:', error);
    if (msgDiv) {
      msgDiv.innerHTML = '<small style="color: #c00;">❌ Network error. Please try again.</small>';
    }
  }
}

// Make functions available globally for onclick handlers
declare global {
  interface Window {
    attachHandlers: (domain?: string) => void;
    toggleLike: (postId: string) => Promise<void>;
    toggleRepost: (postId: string) => Promise<void>;
    showReplyForm: (postId: string) => void;
    hideReplyForm: (postId: string) => void;
    handleRemoteFollow: (event: Event) => Promise<void>;
  }
}

// Export for global assignment
if (typeof window !== 'undefined') {
  window.toggleLike = toggleLike;
  window.toggleRepost = toggleRepost;
  window.showReplyForm = showReplyForm;
  window.hideReplyForm = hideReplyForm;
  window.handleRemoteFollow = handleRemoteFollow;
}