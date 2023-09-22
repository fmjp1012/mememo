"use client";

export default function LoginButton() {
  function handleLogin() {
    // Laravelのエンドポイントにリダイレクト
    window.location.href = "http://localhost:8080/api/google/login";
  }

  return (
    <button onClick={handleLogin}>Sign in with Google</button>
  );
}