import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  deleteUser,
  getAuth,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  serverTimestamp,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import { appSettings } from "./app-settings.js";

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);
const persistenceReady = setPersistence(auth, browserLocalPersistence);

let signupInProgress = false;

function showScreen(screenId) {
  document.querySelectorAll(".screen").forEach((screen) => {
    screen.classList.remove("active");
  });

  const target = document.getElementById(screenId);
  if (!target) {
    return;
  }

  target.classList.add("active");
  window.scrollTo({ top: 0, behavior: "auto" });
}

function setMessage(elementId, text, type = "") {
  const element = document.getElementById(elementId);
  if (!element) {
    return;
  }

  element.textContent = text;
  if (type) {
    element.dataset.type = type;
  } else {
    delete element.dataset.type;
  }
}

function setBusy(buttonId, busy, busyText, normalText) {
  const button = document.getElementById(buttonId);
  if (!button) {
    return;
  }

  button.disabled = busy;
  button.textContent = busy ? busyText : normalText;
}

function normalizeName(name) {
  return name
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("ko-KR");
}

function normalizeCode(code) {
  return code.normalize("NFKC").trim();
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function randomCharacters(length) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const values = new Uint32Array(length);
  crypto.getRandomValues(values);

  return Array.from(values, (value) =>
    alphabet[value % alphabet.length]
  ).join("");
}

function createMemberIdentity() {
  const memberId = randomCharacters(6);
  const suffix = randomCharacters(10).toLowerCase();

  return {
    memberId,
    internalEmail:
      `m${memberId.toLowerCase()}${suffix}@members.jesus-heart2.invalid`
  };
}

function friendlyAuthError(error) {
  switch (error?.code) {
    case "auth/weak-password":
      return "비밀번호는 6자 이상으로 입력해주세요.";
    case "auth/network-request-failed":
      return "인터넷 연결을 확인한 후 다시 시도해주세요.";
    case "auth/too-many-requests":
      return "로그인 시도가 많았습니다. 잠시 후 다시 시도해주세요.";
    default:
      return "처리 중 문제가 생겼습니다. 잠시 후 다시 시도해주세요.";
  }
}

async function routeAuthenticatedUser(user) {
  const profileSnapshot = await getDoc(doc(db, "users", user.uid));

  if (!profileSnapshot.exists()) {
    await signOut(auth);
    setMessage(
      "login-message",
      "회원 정보를 찾을 수 없습니다. 관리자에게 문의해주세요.",
      "error"
    );
    showScreen("login-screen");
    return;
  }

  const profile = profileSnapshot.data();

  if (!profile.approved) {
    document.getElementById("pending-name").textContent =
      `${profile.name}님의 가입 승인을 기다리고 있습니다.`;
    showScreen("pending-screen");
    return;
  }

  document.getElementById("welcome-name").textContent =
    `${profile.name}님, 반갑습니다.`;
  showScreen("home-screen");
}

async function login() {
  const name = document.getElementById("login-name").value;
  const password = document.getElementById("login-password").value;
  const normalizedName = normalizeName(name);

  setMessage("login-message", "");

  if (!normalizedName || !password) {
    setMessage(
      "login-message",
      "이름과 비밀번호를 입력해주세요.",
      "error"
    );
    return;
  }

  setBusy("login-button", true, "확인 중...", "로그인");

  try {
    await persistenceReady;
    const nameHash = await sha256(normalizedName);
    const directorySnapshot = await getDocs(
      collection(db, "loginNames", nameHash, "members")
    );

    let signedInUser = null;
    let throttled = false;

    for (const candidate of directorySnapshot.docs) {
      try {
        const credential = await signInWithEmailAndPassword(
          auth,
          candidate.data().email,
          password
        );
        signedInUser = credential.user;
        break;
      } catch (error) {
        if (error?.code === "auth/too-many-requests") {
          throttled = true;
          break;
        }
      }
    }

    if (throttled) {
      setMessage(
        "login-message",
        "로그인 시도가 많았습니다. 잠시 후 다시 시도해주세요.",
        "error"
      );
      return;
    }

    if (!signedInUser) {
      setMessage(
        "login-message",
        "이름 또는 비밀번호를 확인해주세요.",
        "error"
      );
      return;
    }

    await routeAuthenticatedUser(signedInUser);
  } catch (error) {
    setMessage("login-message", friendlyAuthError(error), "error");
  } finally {
    setBusy("login-button", false, "확인 중...", "로그인");
  }
}

async function signup() {
  const name = document.getElementById("signup-name").value.trim();
  const password = document.getElementById("signup-password").value;
  const passwordConfirm =
    document.getElementById("signup-password-confirm").value;
  const churchCode = document.getElementById("church-code").value;
  const normalizedName = normalizeName(name);

  setMessage("signup-message", "");

  if (!normalizedName || !password || !passwordConfirm || !churchCode) {
    setMessage("signup-message", "모든 항목을 입력해주세요.", "error");
    return;
  }

  if (name.length < 2) {
    setMessage("signup-message", "이름을 두 글자 이상 입력해주세요.", "error");
    return;
  }

  if (password.length < 6) {
    setMessage("signup-message", "비밀번호는 6자 이상 입력해주세요.", "error");
    return;
  }

  if (password !== passwordConfirm) {
    setMessage("signup-message", "비밀번호가 서로 다릅니다.", "error");
    return;
  }

  setBusy("signup-button", true, "신청 중...", "가입 신청");
  signupInProgress = true;

  let createdUser = null;

  try {
    const submittedCodeHash = await sha256(normalizeCode(churchCode));
    if (submittedCodeHash !== appSettings.churchJoinCodeHash) {
      setMessage("signup-message", "교회 가입코드를 확인해주세요.", "error");
      return;
    }

    await persistenceReady;

    const { memberId, internalEmail } = createMemberIdentity();
    const nameHash = await sha256(normalizedName);
    const credential = await createUserWithEmailAndPassword(
      auth,
      internalEmail,
      password
    );
    createdUser = credential.user;

    const batch = writeBatch(db);
    const userReference = doc(db, "users", createdUser.uid);
    const loginReference = doc(
      db,
      "loginNames",
      nameHash,
      "members",
      createdUser.uid
    );
    const memberIdReference = doc(db, "memberIds", memberId);

    batch.set(userReference, {
      uid: createdUser.uid,
      memberId,
      name,
      nameNormalized: normalizedName,
      nameHash,
      role: "member",
      approved: false,
      createdAt: serverTimestamp(),
      settings: {
        fontSize: "normal",
        notifications: false
      }
    });

    batch.set(loginReference, {
      uid: createdUser.uid,
      email: internalEmail,
      memberId,
      nameHash,
      createdAt: serverTimestamp()
    });

    batch.set(memberIdReference, {
      uid: createdUser.uid,
      createdAt: serverTimestamp()
    });

    await batch.commit();

    document.getElementById("pending-name").textContent =
      `${name}님의 가입 신청이 접수되었습니다.`;
    showScreen("pending-screen");
  } catch (error) {
    if (createdUser) {
      try {
        await deleteUser(createdUser);
      } catch {
        // 생성 도중 실패한 계정은 관리자가 Authentication에서 확인할 수 있다.
      }
    }

    setMessage("signup-message", friendlyAuthError(error), "error");
  } finally {
    signupInProgress = false;
    setBusy("signup-button", false, "신청 중...", "가입 신청");
  }
}

async function logout() {
  try {
    await signOut(auth);
  } finally {
    document.getElementById("login-password").value = "";
    setMessage("login-message", "");
    showScreen("login-screen");
  }
}

const dailyMessages = [
  "오늘도 주님과 함께 걸어가요.",
  "오늘 하루도 예수님의 마음으로.",
  "작은 믿음도 하나님께는 소중합니다.",
  "오늘 받은 은혜를 마음에 담아보세요.",
  "주님과 함께하는 오늘이 되기를 바랍니다.",
  "오늘도 말씀 안에서 평안하세요."
];

function setDailyMessage() {
  const messageElement = document.getElementById("daily-message");
  if (!messageElement) {
    return;
  }

  const randomIndex = Math.floor(Math.random() * dailyMessages.length);
  messageElement.textContent = dailyMessages[randomIndex];
}

document.getElementById("login-password").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    login();
  }
});

document
  .getElementById("church-code")
  .addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      signup();
    }
  });

onAuthStateChanged(auth, async (user) => {
  if (signupInProgress) {
    return;
  }

  if (!user) {
    showScreen("login-screen");
    return;
  }

  try {
    await routeAuthenticatedUser(user);
  } catch {
    setMessage(
      "login-message",
      "회원 상태를 확인하지 못했습니다. 다시 로그인해주세요.",
      "error"
    );
    showScreen("login-screen");
  }
});

setDailyMessage();

window.showScreen = showScreen;
window.login = login;
window.signup = signup;
window.logout = logout;

export { auth, db };
