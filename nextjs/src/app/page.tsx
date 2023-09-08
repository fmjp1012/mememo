'use client'

import React, { useState } from 'react';

export default function Home() {
  const [inputValue, setInputValue] = useState('');

  const handleChange = (e: { target: { value: React.SetStateAction<string>; }; }) => {
    setInputValue(e.target.value);
  };

  return (
    <main>
      <input
        type="text"
        className="border"
        value={inputValue}
        onChange={handleChange}
      />
      <p>入力された値: {inputValue}</p>
    </main>
  );
}
