// firebase.js — connects to our Firestore database.
// Every other module that needs to talk to Firestore imports `db` from here,
// so this is the only place the connection is set up.

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyA8cXq-FoHrQLL_W99cwEfkYMbqXdwuODM",
  authDomain: "aramp-shared-minds.firebaseapp.com",
  projectId: "aramp-shared-minds",
  storageBucket: "aramp-shared-minds.firebasestorage.app",
  messagingSenderId: "468403415211",
  appId: "1:468403415211:web:630b97b987cc5a8f636fee",
};

const app = initializeApp(firebaseConfig);

// The Firestore security rules only allow reading and writing documents
// inside the "memories" collection — that's the only thing this whole
// project touches.
export const db = getFirestore(app);
