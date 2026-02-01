# MyCLI - AI 기반 CLI 에이전트

`MyCLI`는 LangChain.js를 기반으로 구축된 대화형 AI 커맨드 라인 에이전트입니다. 로컬 파일 시스템 접근, 셸 명령어 실행 등 강력한 기능을 통해 개발 작업을 보조합니다. Google Gemini, OpenAI, Ollama 등 다양한 언어 모델을 지원합니다.

## ✨ 주요 기능

- **🤖 대화형 AI 어시스턴트**: 자연어 명령을 통해 AI와 상호작용할 수 있습니다.
- **🔌 다중 LLM 지원**: Google Gemini, OpenAI, Ollama 모델을 손쉽게 전환하며 사용할 수 있습니다.
- **🛠️ 확장 가능한 도구**:
  - `read_file`: 파일 내용을 읽습니다.
  - `write_file`: 새 파일을 생성하거나 기존 파일에 덮어씁니다.
  - `execute_shell_command`: 안전 모드에서 셸 명령어를 실행합니다.
- **🔒 보안**:
  - 프로젝트 디렉터리 외부의 파일 시스템 접근을 차단합니다.
  - `rm`, `del` 등 위험할 수 있는 셸 명령어 실행을 방지합니다.
- **🗂️ 파일 컨텍스트 대화**: `@` 기호를 사용하여 특정 파일의 내용을 컨텍스트로 첨부하고 질문할 수 있습니다.
- **📜 명령어 히스토리**: 대화 기록을 관리하는 `/list`, `/save`, `/clear`와 같은 내장 명령어를 제공합니다.

## ⚙️ 요구 사항

- Node.js (v18 이상 권장)
- npm
- Google Gemini 또는 OpenAI API 키, 혹은 로컬에서 실행 중인 Ollama 인스턴스

## 🚀 설치 및 설정

1.  **프로젝트 클론 및 의존성 설치**:
    ```bash
    git clone <repository-url>
    cd mycli
    npm install
    ```

2.  **환경 변수 설정**:
    `.env_example` 파일을 복사하여 `.env` 파일을 생성합니다.
    ```bash
    cp .env_example .env
    ```
    이후, `.env` 파일을 열고 사용할 AI 공급자에 맞춰 환경 변수를 설정합니다.

    - **Google Gemini 사용 시**:
      ```
      GOOGLE_API_KEY="YOUR_GEMINI_API_KEY"
      ```

    - **OpenAI 사용 시**:
      ```
      OPENAI_API_KEY="YOUR_OPENAI_API_KEY"
      ```

    - **Ollama 사용 시**:
      ```
      OLLAMA_BASE_URL="http://localhost:11434"
      OLLAMA_MODEL="gemma2:9b"
      ```
      *`cli-agent.js`의 `getModel()` 함수에서 사용할 기본 모델을 변경할 수 있습니다.*

## ▶️ 사용법

1.  **CLI 에이전트 실행**:
    ```bash
    node cli-agent.js
    ```

2.  **AI와 대화하기**:
    프롬프트가 나타나면 자유롭게 질문하거나 명령을 내릴 수 있습니다.
    ```
    KYJ_AI > 현재 폴더에 있는 파일 목록을 보여줘
    ```

3.  **내장 명령어 사용**:
    - `/help`: 사용 가능한 모든 명령어를 보여줍니다.
    - `/list`: 현재 세션의 대화 기록을 콘솔에 출력합니다.
    - `/save`: 현재까지의 대화 내용을 Markdown 파일로 저장합니다.
    - `/clear`: 현재 세션의 대화 기록을 모두 지웁니다.
    - `/exit`: CLI를 종료합니다.

4.  **파일 컨텍스트 대화**:
    `@` 기호와 함께 파일 이름을 입력하면, 해당 파일을 컨텍스트로 첨부하여 질문할 수 있습니다.
    ```
    KYJ_AI > @package.json
    ```
    위와 같이 입력하면 파일을 선택하는 창이 나타나고, 파일을 선택한 후 해당 파일의 내용에 대해 질문할 수 있습니다.

## 📄 라이선스

이 프로젝트는 [Apache 2.0 License](LICENSE.txt)를 따릅니다.
