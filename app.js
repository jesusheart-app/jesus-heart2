import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);

/*
      예수마음 jesus-heart2

      중요:
      이 파일은 앱의 유일한 시작점입니다.

      index2.html
      index3.html
      등 별도의 시작 화면을 만들지 않습니다.

      실제 회원가입, 로그인, Firebase,
      관리자 권한 등의 기능은 이후 단계에서
      별도의 JavaScript 구조로 연결합니다.
    */


    // -----------------------------------------
    // 화면 전환
    // -----------------------------------------

    function showScreen(screenId) {

      const screens = document.querySelectorAll(".screen");

      screens.forEach(function(screen) {
        screen.classList.remove("active");
      });


      const target = document.getElementById(screenId);

      if (target) {
        target.classList.add("active");

        window.scrollTo({
          top: 0,
          behavior: "instant"
        });
      }
    }


    // -----------------------------------------
    // 현재는 테스트용 로그인
    // 실제 로그인 기능은 Firebase 연결 후 구현
    // -----------------------------------------

    function login() {

      const name =
        document.getElementById("login-name").value.trim();

      const password =
        document.getElementById("login-password").value.trim();

      const message =
        document.getElementById("login-message");


      if (!name || !password) {

        message.textContent =
          "이름과 비밀번호를 입력해주세요.";

        return;
      }


      message.textContent =
        "현재는 화면 구조 테스트 단계입니다.";


      setTimeout(function() {
        showScreen("home-screen");
      }, 500);
    }


    // -----------------------------------------
    // 현재는 테스트용 회원가입
    // 실제 회원가입은 Firebase 연결 후 구현
    // -----------------------------------------

    function signup() {

      const name =
        document.getElementById("signup-name").value.trim();

      const password =
        document.getElementById("signup-password").value.trim();

      const churchCode =
        document.getElementById("church-code").value.trim();

      const message =
        document.getElementById("signup-message");


      if (!name || !password || !churchCode) {

        message.textContent =
          "모든 항목을 입력해주세요.";

        return;
      }


      message.textContent =
        "회원가입 기능은 다음 단계에서 연결합니다.";
    }


    // -----------------------------------------
    // 로그아웃
    // -----------------------------------------

    function logout() {

      showScreen("login-screen");

      document.getElementById("login-message").textContent =
        "";
    }


    // -----------------------------------------
    // 첫 화면 문구
    // -----------------------------------------

    const dailyMessages = [

      "오늘도 주님과 함께 걸어가요.",

      "오늘 하루도 예수님의 마음으로.",

      "작은 믿음도 하나님께는 소중합니다.",

      "오늘 받은 은혜를 마음에 담아보세요.",

      "주님과 함께하는 오늘이 되기를 바랍니다.",

      "오늘도 말씀 안에서 평안하세요."
    ];


    function setDailyMessage() {

      const messageElement =
        document.getElementById("daily-message");

      if (!messageElement) {
        return;
      }


      const randomIndex =
        Math.floor(
          Math.random() * dailyMessages.length
        );


      messageElement.textContent =
        dailyMessages[randomIndex];
    }


    setDailyMessage();

window.showScreen = showScreen;
window.login = login;
window.signup = signup;
window.logout = logout;

export { auth, db };
