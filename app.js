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
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import { appSettings } from "./app-settings.js";

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);
const persistenceReady = setPersistence(auth, browserLocalPersistence);

let signupInProgress = false;
let currentUserProfile = null;

function showScreen(screenId, options = {}) {
  const target = document.getElementById(screenId);
  if (!target || !target.classList.contains("screen")) {
    return;
  }

  const activeScreen = document.querySelector(".screen.active");
  const historyMode = options.historyMode || "push";

  document.querySelectorAll(".screen").forEach((screen) => {
    screen.classList.remove("active");
  });

  target.classList.add("active");

  if (historyMode === "push" && activeScreen?.id !== screenId) {
    history.pushState({ screenId }, "", window.location.href);
  } else if (historyMode === "replace") {
    history.replaceState({ screenId }, "", window.location.href);
  }

  window.scrollTo({ top: 0, behavior: "auto" });
}

function getSafeHistoryScreen(requestedScreenId) {
  const requestedScreen = document.getElementById(requestedScreenId);
  const screenExists = requestedScreen?.classList.contains("screen");

  if (!auth.currentUser) {
    return requestedScreenId === "signup-screen" && screenExists
      ? "signup-screen"
      : "login-screen";
  }

  if (currentUserProfile?.approved !== true) {
    return "pending-screen";
  }

  if (
    requestedScreenId === "admin-members-screen" &&
    currentUserProfile.role !== "admin"
  ) {
    return "home-screen";
  }

  if (
    !screenExists ||
    ["login-screen", "signup-screen", "pending-screen"].includes(
      requestedScreenId
    )
  ) {
    return "home-screen";
  }

  return requestedScreenId;
}

function goBackOrHome() {
  const activeScreen = document.querySelector(".screen.active");

  if (
    activeScreen &&
    activeScreen.id !== "home-screen" &&
    history.state?.screenId === activeScreen.id
  ) {
    history.back();
    return;
  }

  showScreen("home-screen", { historyMode: "replace" });
}

window.addEventListener("popstate", (event) => {
  const requestedScreenId = event.state?.screenId;
  const safeScreenId = getSafeHistoryScreen(requestedScreenId);
  const historyMode =
    requestedScreenId === safeScreenId ? "none" : "replace";

  showScreen(safeScreenId, { historyMode });
});

history.replaceState(
  { screenId: "login-screen" },
  "",
  window.location.href
);

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
    showScreen("login-screen", { historyMode: "replace" });
    return;
  }

  const profile = profileSnapshot.data();
  currentUserProfile = profile;

  const adminHomeButton = document.getElementById("admin-home-button");
  if (adminHomeButton) {
    adminHomeButton.hidden = !(profile.approved && profile.role === "admin");
  }

  if (!profile.approved) {
    document.getElementById("pending-name").textContent =
      `${profile.name}님의 가입 승인을 기다리고 있습니다.`;
    showScreen("pending-screen", { historyMode: "replace" });
    return;
  }

  document.getElementById("welcome-name").textContent =
    `${profile.name}님, 반갑습니다.`;
  showScreen("home-screen", { historyMode: "replace" });
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
    showScreen("pending-screen", { historyMode: "replace" });
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
    showScreen("login-screen", { historyMode: "replace" });
  }
}



function getTodayDateKey() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return year + "-" + month + "-" + day;
}

function isValidBibleCheckDate(dateKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || dateKey > getTodayDateKey()) {
    return false;
  }

  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);

  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

function formatBibleCheckDate(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short"
  });
}

function getBibleCheckReference(dateKey) {
  return doc(
    db,
    "users",
    auth.currentUser.uid,
    "bibleChecks",
    dateKey
  );
}

function getCommunityBibleReference(dateKey) {
  return doc(
    db,
    "communityBibleChecks",
    dateKey,
    "participants",
    auth.currentUser.uid
  );
}

function renderTodayCommunityBibleCount(count, currentUserCompleted) {
  const message = document.getElementById("community-bible-message");
  const sprouts = document.getElementById("community-bible-sprouts");
  const memberName = currentUserProfile?.name || "회원";

  if (currentUserCompleted) {
    message.textContent =
      memberName + "님까지 오늘 " + count + "명이 말씀을 읽었어요.";
  } else if (count === 0) {
    message.textContent =
      "오늘은 아직 첫 말씀체크를 기다리고 있어요. " +
      memberName + "님이 함께 시작해보세요.";
  } else {
    message.textContent =
      "오늘 " + count + "명이 말씀과 함께했어요. " +
      memberName + "님도 함께해요.";
  }

  sprouts.textContent =
    count > 0 ? Array(Math.min(count, 20)).fill("🌱").join(" ") : "♡";
  sprouts.setAttribute(
    "aria-label",
    "오늘 말씀을 읽은 사람 " + count + "명"
  );
}

async function loadTodayCommunityBibleCount() {
  const today = getTodayDateKey();
  const personalReference = getBibleCheckReference(today);
  const communityReference = getCommunityBibleReference(today);
  const [personalSnapshot, communitySnapshot] = await Promise.all([
    getDoc(personalReference),
    getDoc(communityReference)
  ]);
  const currentUserCompleted =
    personalSnapshot.exists() &&
    personalSnapshot.data().checked === true;

  if (currentUserCompleted && !communitySnapshot.exists()) {
    await setDoc(communityReference, {
      uid: auth.currentUser.uid,
      date: today,
      createdAt: serverTimestamp()
    });
  } else if (!currentUserCompleted && communitySnapshot.exists()) {
    await deleteDoc(communityReference);
  }

  const participantsSnapshot = await getDocs(
    collection(
      db,
      "communityBibleChecks",
      today,
      "participants"
    )
  );

  renderTodayCommunityBibleCount(
    participantsSnapshot.size,
    currentUserCompleted
  );
}

function renderBibleCheckSelection(dateKey, isChecked) {
  const status = document.getElementById("bible-check-status");
  const button = document.getElementById("bible-check-toggle-button");

  status.textContent = isChecked
    ? formatBibleCheckDate(dateKey) + " 말씀 읽음을 기록했습니다."
    : formatBibleCheckDate(dateKey) + " 기록이 없습니다.";
  status.dataset.checked = String(isChecked);

  button.dataset.checked = String(isChecked);
  button.textContent = isChecked ? "이 날짜의 체크 삭제" : "말씀 읽음 체크하기";
  button.className = isChecked
    ? "secondary-button"
    : "primary-button";
}

async function loadBibleCheckForDate() {
  const dateInput = document.getElementById("bible-check-date");
  const dateKey = dateInput.value;

  setMessage("bible-check-message", "");

  if (!auth.currentUser || !isValidBibleCheckDate(dateKey)) {
    setMessage(
      "bible-check-message",
      "오늘 또는 지난 날짜를 선택해주세요.",
      "error"
    );
    return;
  }

  const snapshot = await getDoc(getBibleCheckReference(dateKey));
  renderBibleCheckSelection(
    dateKey,
    snapshot.exists() && snapshot.data().checked === true
  );
}

function renderBibleCheckHistory(documents) {
  const list = document.getElementById("bible-check-history");
  list.replaceChildren();

  const records = documents
    .filter((record) => record.data().checked === true)
    .sort((first, second) => second.id.localeCompare(first.id));

  if (records.length === 0) {
    const empty = document.createElement("p");
    empty.className = "bible-check-empty";
    empty.textContent = "아직 기록한 날짜가 없습니다.";
    list.append(empty);
    return;
  }

  records.forEach((record) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "bible-check-history-row";

    const date = document.createElement("span");
    date.textContent = formatBibleCheckDate(record.id);

    const state = document.createElement("span");
    state.className = "bible-check-history-state";
    state.textContent = "읽음 완료";

    row.append(date, state);
    row.addEventListener("click", async () => {
      document.getElementById("bible-check-date").value = record.id;
      await loadBibleCheckForDate();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    list.append(row);
  });
}

async function loadBibleCheckHistory() {
  const snapshot = await getDocs(
    collection(db, "users", auth.currentUser.uid, "bibleChecks")
  );
  renderBibleCheckHistory(snapshot.docs);
}

async function openBibleCheck() {
  if (!auth.currentUser || currentUserProfile?.approved !== true) {
    showScreen("login-screen", { historyMode: "replace" });
    return;
  }

  const dateInput = document.getElementById("bible-check-date");
  const today = getTodayDateKey();
  dateInput.max = today;

  if (!isValidBibleCheckDate(dateInput.value)) {
    dateInput.value = today;
  }

  showScreen("bible-check-screen");
  setMessage("bible-check-message", "기록을 불러오는 중입니다.");

  try {
    await Promise.all([
      loadBibleCheckForDate(),
      loadBibleCheckHistory(),
      loadTodayCommunityBibleCount()
    ]);
    setMessage("bible-check-message", "");
  } catch {
    setMessage(
      "bible-check-message",
      "말씀체크 기록을 불러오지 못했습니다. 다시 시도해주세요.",
      "error"
    );
  }
}

async function toggleBibleCheck() {
  const dateInput = document.getElementById("bible-check-date");
  const button = document.getElementById("bible-check-toggle-button");
  const dateKey = dateInput.value;
  const isChecked = button.dataset.checked === "true";

  setMessage("bible-check-message", "");

  if (!auth.currentUser || !isValidBibleCheckDate(dateKey)) {
    setMessage(
      "bible-check-message",
      "오늘 또는 지난 날짜를 선택해주세요.",
      "error"
    );
    return;
  }

  if (isChecked && !window.confirm("정말 삭제하시겠습니까?")) {
    return;
  }

  const originalButtonText = button.textContent;
  button.disabled = true;
  button.textContent = isChecked ? "삭제 중..." : "저장 중...";

  try {
    const reference = getBibleCheckReference(dateKey);
    const communityReference = getCommunityBibleReference(dateKey);
    const batch = writeBatch(db);

    if (isChecked) {
      batch.delete(reference);
      batch.delete(communityReference);
    } else {
      batch.set(reference, {
        uid: auth.currentUser.uid,
        date: dateKey,
        checked: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      batch.set(communityReference, {
        uid: auth.currentUser.uid,
        date: dateKey,
        createdAt: serverTimestamp()
      });
    }

    await batch.commit();

    await Promise.all([
      loadBibleCheckForDate(),
      loadBibleCheckHistory(),
      loadTodayCommunityBibleCount()
    ]);

    setMessage(
      "bible-check-message",
      isChecked ? "말씀체크 기록을 삭제했습니다." : "말씀 읽음을 기록했습니다.",
      "success"
    );
  } catch {
    button.textContent = originalButtonText;
    setMessage(
      "bible-check-message",
      "기록을 변경하지 못했습니다. 잠시 후 다시 시도해주세요.",
      "error"
    );
  } finally {
    button.disabled = false;
  }
}


function getMemoryCheckReference(dateKey) {
  return doc(
    db,
    "users",
    auth.currentUser.uid,
    "memoryChecks",
    dateKey
  );
}

function renderMemoryCheckState(isCompleted) {
  const status = document.getElementById("memory-check-status");
  const button = document.getElementById("memory-check-toggle-button");

  status.textContent = isCompleted
    ? "오늘 암송 완료를 기록했습니다."
    : "오늘의 암송 기록이 아직 없습니다.";
  status.dataset.completed = String(isCompleted);

  button.dataset.completed = String(isCompleted);
  button.textContent = isCompleted ? "오늘 기록 삭제" : "오늘 암송 완료";
  button.className = isCompleted
    ? "secondary-button"
    : "primary-button";
}

function renderMemoryCheckHistory(documents) {
  const list = document.getElementById("memory-check-history");
  list.replaceChildren();

  const records = documents
    .filter((record) => record.data().completed === true)
    .sort((first, second) => second.id.localeCompare(first.id));

  if (records.length === 0) {
    const empty = document.createElement("p");
    empty.className = "memory-check-empty";
    empty.textContent = "아직 암송을 기록한 날이 없습니다.";
    list.append(empty);
    return;
  }

  records.forEach((record) => {
    const row = document.createElement("div");
    row.className = "memory-check-history-row";

    const date = document.createElement("span");
    date.textContent = formatBibleCheckDate(record.id);

    const state = document.createElement("span");
    state.className = "memory-check-history-state";
    state.textContent = "암송 완료";

    row.append(date, state);
    list.append(row);
  });
}

async function loadMemoryChecks() {
  const today = getTodayDateKey();
  const [todaySnapshot, historySnapshot] = await Promise.all([
    getDoc(getMemoryCheckReference(today)),
    getDocs(
      collection(db, "users", auth.currentUser.uid, "memoryChecks")
    )
  ]);

  renderMemoryCheckState(
    todaySnapshot.exists() &&
    todaySnapshot.data().completed === true
  );
  renderMemoryCheckHistory(historySnapshot.docs);
}

async function openMemoryCheck() {
  if (!auth.currentUser || currentUserProfile?.approved !== true) {
    showScreen("login-screen", { historyMode: "replace" });
    return;
  }

  showScreen("memory-screen");
  setMessage("memory-check-message", "암송 기록을 불러오는 중입니다.");

  try {
    await loadMemoryChecks();
    setMessage("memory-check-message", "");
  } catch {
    setMessage(
      "memory-check-message",
      "암송 기록을 불러오지 못했습니다. 다시 시도해주세요.",
      "error"
    );
  }
}

async function toggleMemoryCheck() {
  const button = document.getElementById("memory-check-toggle-button");
  const isCompleted = button.dataset.completed === "true";

  setMessage("memory-check-message", "");

  if (!auth.currentUser || currentUserProfile?.approved !== true) {
    showScreen("login-screen", { historyMode: "replace" });
    return;
  }

  if (isCompleted && !window.confirm("정말 삭제하시겠습니까?")) {
    return;
  }

  const originalButtonText = button.textContent;
  button.disabled = true;
  button.textContent = isCompleted ? "삭제 중..." : "저장 중...";

  try {
    const today = getTodayDateKey();
    const reference = getMemoryCheckReference(today);

    if (isCompleted) {
      await deleteDoc(reference);
    } else {
      await setDoc(reference, {
        uid: auth.currentUser.uid,
        date: today,
        completed: true,
        createdAt: serverTimestamp()
      });
    }

    await loadMemoryChecks();

    setMessage(
      "memory-check-message",
      isCompleted ? "오늘의 암송 기록을 삭제했습니다." : "오늘의 암송을 기록했습니다.",
      "success"
    );
  } catch {
    button.textContent = originalButtonText;
    setMessage(
      "memory-check-message",
      "암송 기록을 변경하지 못했습니다. 잠시 후 다시 시도해주세요.",
      "error"
    );
  } finally {
    button.disabled = false;
  }
}

function isCurrentUserApprovedAdmin() {
  return Boolean(
    auth.currentUser &&
    currentUserProfile?.approved === true &&
    currentUserProfile?.role === "admin"
  );
}

function formatCreatedAt(createdAt) {
  if (!createdAt || typeof createdAt.toDate !== "function") {
    return "가입일 확인 중";
  }

  return createdAt.toDate().toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric"
  });
}

function createMemberBadge(text, type) {
  const badge = document.createElement("span");
  badge.className = "member-badge member-badge-" + type;
  badge.textContent = text;
  return badge;
}

function createAdminActionButton(label, className, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", () => onClick(button));
  return button;
}

function renderAdminMembers(memberDocuments) {
  const list = document.getElementById("admin-member-list");
  const summary = document.getElementById("admin-summary");

  list.replaceChildren();

  const members = memberDocuments
    .map((memberDocument) => ({
      uid: memberDocument.id,
      ...memberDocument.data()
    }))
    .sort((first, second) => {
      if (first.approved !== second.approved) {
        return first.approved ? 1 : -1;
      }

      return String(first.name).localeCompare(String(second.name), "ko");
    });

  const pendingCount = members.filter((member) => !member.approved).length;
  summary.textContent =
    "전체 " + members.length + "명 · 승인 대기 " + pendingCount + "명";

  if (members.length === 0) {
    const empty = document.createElement("p");
    empty.className = "admin-empty";
    empty.textContent = "가입한 회원이 없습니다.";
    list.append(empty);
    return;
  }

  members.forEach((member) => {
    const card = document.createElement("article");
    card.className = "member-card";

    const heading = document.createElement("div");
    heading.className = "member-card-heading";

    const name = document.createElement("h2");
    name.textContent = member.name || "이름 없음";
    heading.append(name);

    const badges = document.createElement("div");
    badges.className = "member-badges";
    badges.append(
      createMemberBadge(
        member.approved ? "승인됨" : "승인 대기",
        member.approved ? "approved" : "pending"
      ),
      createMemberBadge(
        member.role === "admin" ? "관리자" : "일반회원",
        member.role === "admin" ? "admin" : "member"
      )
    );
    heading.append(badges);
    card.append(heading);

    const details = document.createElement("p");
    details.className = "member-details";
    details.textContent =
      "회원번호 " + (member.memberId || "-") + " · " +
      formatCreatedAt(member.createdAt);
    card.append(details);

    const actions = document.createElement("div");
    actions.className = "member-actions";

    if (member.uid === auth.currentUser?.uid) {
      const currentAdmin = document.createElement("p");
      currentAdmin.className = "current-admin-note";
      currentAdmin.textContent = "현재 로그인한 관리자 계정";
      actions.append(currentAdmin);
    } else {
      if (!member.approved) {
        actions.append(
          createAdminActionButton(
            "가입 승인",
            "primary-button admin-action-button",
            (button) => updateMemberAccess(member.uid, { approved: true }, button)
          )
        );
      }

      if (member.approved) {
        const makeAdmin = member.role !== "admin";
        actions.append(
          createAdminActionButton(
            makeAdmin ? "관리자로 지정" : "일반회원으로 변경",
            "secondary-button admin-action-button",
            (button) =>
              updateMemberAccess(
                member.uid,
                { role: makeAdmin ? "admin" : "member" },
                button
              )
          )
        );
      }
    }

    card.append(actions);
    list.append(card);
  });
}

async function loadAdminMembers() {
  if (!isCurrentUserApprovedAdmin()) {
    showScreen("home-screen", { historyMode: "replace" });
    return;
  }

  setMessage("admin-message", "회원 목록을 불러오는 중입니다.");
  const snapshot = await getDocs(collection(db, "users"));
  renderAdminMembers(snapshot.docs);
  setMessage("admin-message", "");
}

async function updateMemberAccess(uid, changes, button) {
  if (!isCurrentUserApprovedAdmin() || uid === auth.currentUser?.uid) {
    setMessage(
      "admin-message",
      "현재 관리자 계정의 권한은 이 화면에서 변경할 수 없습니다.",
      "error"
    );
    return;
  }

  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "처리 중...";

  try {
    await updateDoc(doc(db, "users", uid), changes);
    await loadAdminMembers();
    setMessage("admin-message", "회원 권한을 변경했습니다.", "success");
  } catch {
    button.disabled = false;
    button.textContent = originalText;
    setMessage(
      "admin-message",
      "권한을 변경하지 못했습니다. 잠시 후 다시 시도해주세요.",
      "error"
    );
  }
}

async function openAdminMembers() {
  if (!isCurrentUserApprovedAdmin()) {
    setMessage(
      "login-message",
      "관리자만 회원관리를 이용할 수 있습니다.",
      "error"
    );
    showScreen("home-screen", { historyMode: "replace" });
    return;
  }

  showScreen("admin-members-screen");

  try {
    await loadAdminMembers();
  } catch {
    setMessage(
      "admin-message",
      "회원 목록을 불러오지 못했습니다. 다시 시도해주세요.",
      "error"
    );
  }
}

const greetingPeriods = [
  {
    key: "morning",
    startHour: 5,
    messages: [
      "주님과 함께 새로운 하루를 시작해요.",
      "오늘도 말씀 안에서 힘찬 하루 보내세요.",
      "새 아침을 주신 주님께 감사하며 걸어가요.",
      "주님의 사랑 안에서 기쁜 하루가 되기를 바라요.",
      "오늘의 모든 걸음을 주님께 맡겨보세요.",
      "맑은 아침처럼 마음에도 평안이 가득하기를 바라요.",
      "작은 기도로 오늘 하루를 열어보세요.",
      "오늘도 예수님의 마음을 품고 시작해요."
    ]
  },
  {
    key: "afternoon",
    startHour: 12,
    messages: [
      "분주한 오후에도 잠시 주님 안에서 쉬어가세요.",
      "남은 하루도 주님이 주시는 힘으로 걸어가요.",
      "잠시 마음을 가다듬고 말씀을 떠올려보세요.",
      "오늘의 수고 가운데에도 주님의 은혜가 함께해요.",
      "따뜻한 마음으로 남은 하루를 이어가세요.",
      "오후의 걸음에도 주님의 평안이 함께하기를 바라요.",
      "작은 감사 하나를 떠올리며 힘을 내보세요.",
      "주님 안에서 마음의 여유를 누리는 오후가 되세요."
    ]
  },
  {
    key: "evening",
    startHour: 18,
    messages: [
      "오늘 하루 함께하신 주님의 은혜를 돌아보세요.",
      "수고 많으셨어요. 주님 안에서 편안한 저녁 보내세요.",
      "감사한 일을 하나씩 떠올리며 저녁을 맞이해요.",
      "오늘의 기쁨과 어려움을 주님께 맡겨보세요.",
      "사랑하는 이들과 따뜻한 저녁 보내세요.",
      "하루의 끝자락에서도 주님의 평안을 누리세요.",
      "오늘 받은 은혜를 마음에 곱게 담아보세요.",
      "주님과 함께한 오늘을 감사로 마무리해요."
    ]
  },
  {
    key: "night",
    startHour: 22,
    messages: [
      "오늘도 수고 많으셨어요. 주님 안에서 편히 쉬세요.",
      "고요한 밤, 주님의 평안이 마음에 머물기를 바라요.",
      "오늘의 모든 염려를 주님께 내려놓고 쉬어가세요.",
      "주님의 사랑 안에서 평안한 밤 보내세요.",
      "감사로 하루를 마치고 편안히 잠드세요.",
      "내일의 걸음도 주님께 맡기며 쉬어가세요.",
      "지친 마음까지 주님이 따뜻하게 안아주시기를 바라요.",
      "오늘 함께하신 주님을 기억하며 평안히 쉬세요."
    ]
  }
];

function getGreetingPeriod(hour) {
  if (hour >= 22 || hour < 5) {
    return greetingPeriods.find((period) => period.key === "night");
  }

  if (hour >= 18) {
    return greetingPeriods.find((period) => period.key === "evening");
  }

  if (hour >= 12) {
    return greetingPeriods.find((period) => period.key === "afternoon");
  }

  return greetingPeriods.find((period) => period.key === "morning");
}

function getGreetingDayNumber(date) {
  return Math.floor(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) /
      (24 * 60 * 60 * 1000)
  );
}

function setDailyMessage() {
  const messageElement = document.getElementById("daily-message");
  if (!messageElement) {
    return;
  }

  const now = new Date();
  const period = getGreetingPeriod(now.getHours());
  const periodIndex = greetingPeriods.findIndex(
    (candidate) => candidate.key === period.key
  );
  const messageIndex =
    (getGreetingDayNumber(now) + periodIndex * 3) %
    period.messages.length;

  messageElement.textContent = period.messages[messageIndex];
  messageElement.dataset.greetingPeriod = period.key;
  messageElement.dataset.greetingDate =
    now.getFullYear() + "-" +
    String(now.getMonth() + 1).padStart(2, "0") + "-" +
    String(now.getDate()).padStart(2, "0");
}

document.getElementById("login-password").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    login();
  }
});

document
  .getElementById("bible-check-date")
  .addEventListener("change", async () => {
    try {
      await loadBibleCheckForDate();
    } catch {
      setMessage(
        "bible-check-message",
        "선택한 날짜의 기록을 확인하지 못했습니다.",
        "error"
      );
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
    currentUserProfile = null;
    const adminHomeButton = document.getElementById("admin-home-button");
    if (adminHomeButton) {
      adminHomeButton.hidden = true;
    }
    showScreen("login-screen", { historyMode: "replace" });
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
    showScreen("login-screen", { historyMode: "replace" });
  }
});

setDailyMessage();

setInterval(setDailyMessage, 60 * 1000);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    setDailyMessage();
  }
});

window.showScreen = showScreen;
window.goBackOrHome = goBackOrHome;
window.login = login;
window.signup = signup;
window.logout = logout;
window.openAdminMembers = openAdminMembers;
window.openBibleCheck = openBibleCheck;
window.toggleBibleCheck = toggleBibleCheck;
window.openMemoryCheck = openMemoryCheck;
window.toggleMemoryCheck = toggleMemoryCheck;

export { auth, db };
