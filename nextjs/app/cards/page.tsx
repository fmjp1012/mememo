"use client";

import axios from "axios";

async function fetchData() {
  try {
    // const response = await axios.get("http://localhost:8080/api/hello");
    const response = await axios.get("https://google.com/");
    console.log(response.data);
  } catch (error) {
    console.error("Error:", error);
  }
}

export default function CardPage() {
  return (
    <div>
      <h1>Welcome to CardPage</h1>
      <button onClick={fetchData}>Fetch Data</button>
    </div>
  );
}
