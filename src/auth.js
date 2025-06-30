// Check if user is logged in on page load
window.addEventListener("load", function () {
  checkAuthState();
});

function checkAuthState() {
  const isLoggedIn = localStorage.getItem("isLoggedIn") === "true";
  const authForms = document.getElementById("auth-forms");
  const loginSection = document.getElementById("login-section");

  if (isLoggedIn) {
    authForms.style.display = "block";
    loginSection.style.display = "none";
  } else {
    authForms.style.display = "none";
    loginSection.style.display = "block";
  }
}

async function handleLogin() {
  const username = document.getElementById("login-username").value;
  const password = document.getElementById("login-password").value;

  if (!username || !password) {
    alert("Please enter both username and password");
    return;
  }

  try {
    const response = await fetch("/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body:
        "username=" +
        encodeURIComponent(username) +
        "&password=" +
        encodeURIComponent(password),
    });

    if (response.ok) {
      localStorage.setItem("isLoggedIn", "true");
      localStorage.setItem("currentUser", username);
      checkAuthState();
      document.getElementById("login-form").reset();
    } else {
      alert("Login failed. Please check your credentials.");
    }
  } catch (error) {
    alert("Login failed. Please try again.");
  }
}
