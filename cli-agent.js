import { ChatOpenAI } from "@langchain/openai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOllama } from "@langchain/ollama";
import { AgentExecutor, createStructuredChatAgent } from "@langchain/classic/agents";
import { BufferMemory } from "@langchain/classic/memory";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod"; // 파라미터 검증용
import inquirer from "inquirer"; // 사용자 입력용
import fs from "fs/promises"; // 비동기 파일 시스템
import path from "path";
import 'dotenv/config';
import { spawn } from "child_process"; // 셸 명령어 실행용

// =========================================================
// [1] 보안 유틸리티: 샌드박스 (Sandboxing)
// =========================================================
// AI가 C드라이브나 루트 디렉터리 등 시스템 중요 파일을 건드리지 못하게 방어합니다.
// 현재 실행 위치(process.cwd()) 하위의 파일만 접근 가능하게 제한합니다.
const BASE_DIR = process.cwd();

function getSafePath(targetPath) {
  const resolvedPath = path.resolve(BASE_DIR, targetPath);
  if (!resolvedPath.startsWith(BASE_DIR)) {
    throw new Error("보안 경고: 현재 작업 디렉터리를 벗어난 파일에는 접근할 수 없습니다.");
  }
  return resolvedPath;
}

// 타임스탬프 생성 헬퍼 함수
function getTimestamp() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}${hours}${minutes}${seconds}`;
}

// =========================================================
// [2] 도구 정의 (AI가 사용할 함수들)
// =========================================================
const tools = [
  // 1. 파일 읽기 도구
  new DynamicStructuredTool({
    name: "read_file",
    description: "파일의 내용을 읽어옵니다. 코드를 분석하거나 내용을 확인할 때 사용하세요.",
    schema: z.object({
      filePath: z.string().describe("읽을 파일의 경로 (예: ./src/index.js)"),
    }),
    func: async ({ filePath }) => {
      try {
        const safePath = getSafePath(filePath);
        const content = await fs.readFile(safePath, "utf-8");
        return `[파일 내용 - ${filePath}]:\n${content}`;
      } catch (error) {
        return `파일 읽기 실패: ${error.message}`;
      }
    },
  }),

  // 2. 파일 쓰기/생성 도구
  new DynamicStructuredTool({
    name: "write_file",
    description: "파일을 생성하거나 내용을 덮어씁니다. 코드를 작성하거나 수정할 때 사용하세요.",
    schema: z.object({
      filePath: z.string().describe("저장할 파일 경로"),
      content: z.string().describe("저장할 파일의 전체 내용"),
    }),
    func: async ({ filePath, content }) => {
      try {
        const safePath = getSafePath(filePath);
        await fs.writeFile(safePath, content, "utf-8");
        return `성공: 파일이 저장되었습니다. (${filePath})`;
      } catch (error) {
        return `파일 쓰기 실패: ${error.message}`;
      }
    },
  }),
  
  // 3. 셸 명령어 실행 도구 (spawn 사용)
  new DynamicStructuredTool({
    name: "execute_shell_command",
    description: "터미널(셸) 명령어를 실행하고 결과를 반환합니다. ipconfig, ls, pwd, date 같은 시스템 확인용 명령에 사용하세요.",
    schema: z.object({
      command: z.string().describe("실행할 셸 명령어 (예: ipconfig)"),
    }),
    func: async ({ command }) => {
      // 보안: 위험 가능성이 있는 명령어 실행 방지
      const blocklist = ["rm", "del", "sudo", "su", "shutdown", "reboot", "mkdir", "touch"];
      const commandBase = command.split(" ")[0];
      if (blocklist.includes(commandBase)) {
        return `에러: 보안상의 이유로 '${commandBase}' 명령어는 실행할 수 없습니다.`;
      }

      console.log(`[툴 실행] 셸 명령어 실행: ${command}`);

      return new Promise((resolve) => {
        const child = spawn(command, {
          shell: 'powershell.exe',
          encoding: 'utf-8'
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (data) => {
          stdout += data.toString();
        });

        child.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        child.on('close', (code) => {
          if (stderr) {
            resolve(`명령어 실행 중 에러 발생 (종료 코드: ${code}):\n${stderr}`);
          } else {
            resolve(`명령어 실행 결과:\n${stdout}`);
          }
        });

        child.on('error', (err) => {
          resolve(`명령어 실행 실패: ${err.message}`);
        });
      });
    },
  }),
];

// =========================================================
// [3] 모델 및 에이전트 설정
// =========================================================
function getModel(provider) {
  if (provider === 'gemini') {
    return new ChatGoogleGenerativeAI({
      //model: "gemini-3-flash-preview",
	  model: "gemini-flash-lite-latest",
      apiKey: process.env.GOOGLE_API_KEY,
      temperature: 0, // 0에 가까울수록 사실적이고 명령 수행에 적합
    });
  } else if (provider === 'llama') {
    return new ChatOllama({
      baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
      model: process.env.OLLAMA_MODEL || "gemma3:1b",
      temperature: 0,
    });
  } else {
    return new ChatOpenAI({
      modelName: "gpt-4o", // gpt-4가 복잡한 파일 작업에 훨씬 유리합니다.
      apiKey: process.env.OPENAI_API_KEY,
      temperature: 0,
    });
  }
}

async function startCLI() {
  console.log("🛠️  AI 개발자 CLI 에이전트 시작 (종료하려면 '/exit' 입력)");
  
  // 1. 모델 선택 (예시를 위해 하드코딩 혹은 inquirer로 선택 가능)
  // 셋 중 하나를 선택하세요: 'gemini', 'openai', 'llama'
  const model = getModel('gemini'); 
  //const model = getModel('openai'); 
  //const model = getModel('gemini'); 

  // 2. 메모리 초기화 (이전 대화를 기억하는 저장소)
  // returnMessages: true는 채팅 메시지 객체 형태로 기억을 저장한다는 뜻입니다.
  const memory = new BufferMemory({
    memoryKey: "chat_history", 
    returnMessages: true, 
  });

  // 3. 에이전트 생성 (LangChain 최신 방식)
  const prompt = ChatPromptTemplate.fromMessages([
    ["system", "You are a helpful assistant. You have access to tools. Your job is to help the user with their requests. The user is a developer. You should respond in Korean.\n\nYou have access to the following tools:\n\n{tools}\n\nTo use a tool, please use the following format. The 'action' should be one of [{tool_names}].\n The \"action_input\" MUST be a JSON object, with keys matching the arguments of the tool.\n\n```json\n{{\n\t\"action\": \"tool_name\",\n\t\"action_input\": {{\n\t\t\"arg_name\": \"arg_value\"\n\t}}\n}}\n```\n\nWhen you have a response to say to the Human, or if you do not need to use a tool, you MUST use the format:\n\n```json\n{{\n\t\"action\": \"Final Answer\",\n\t\"action_input\": \"<your response here>\"\n}}\n```"],
    new MessagesPlaceholder("chat_history"),
    ["human", "{input}"],
    new MessagesPlaceholder({ variableName: "agent_scratchpad", optional: true }),
  ]);

  const agent = await createStructuredChatAgent({
    llm: model,
    tools: tools,
    prompt,
  });

  const executor = new AgentExecutor({
    agent,
    tools: tools,
    // verbose: true, // 이 주석을 풀면 AI의 생각 과정(로그)을 다 볼 수 있습니다.
    maxIterations: 10, // Python의 max_iterations=10
    // Node.js에서는 시간 제한을 AbortSignal로 관리하거나 별도 로직으로 처리합니다.
    handleParsingErrors: true, // Python의 handle_parsing_errors=True
    max_execution_time : 10 //실행 루프에 소요될 수 있는 최대 시간
  });


  // =========================================================
  // [4] 대화 루프 (Interactive Loop)
  // =========================================================
  while (true) {
    let userInput;
    try {
      const answer = await inquirer.prompt([
        {
          type: "input",
          name: "userInput",
          message: "KYJ_AI >",
        },
      ]);
      userInput = answer.userInput;
    } catch (error) {
      if (error && error.name === 'ExitPromptError') {
        const { confirmExit } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirmExit',
            message: '정말로 종료하시겠습니까?',
            default: false,
          },
        ]);
        if (confirmExit) {
          console.log("프로그램을 종료합니다. 안녕히 계세요!");
          process.exit(0);
        } else {
          continue; // Exit confirmed, so continue to the next loop iteration.
        }
      }
      throw error; // Re-throw other errors
    }
    
    if (userInput.toLowerCase() === "/exit") {
      console.log("종료합니다.");
      process.exit(0);
    } 
    //채팅 히스토리를 비움.
    else if (userInput.toLowerCase() === "/clear") {
      await memory.clear(); // 채팅 기록을 지웁니다.
      console.log("✅ 채팅 기록이 지워졌습니다."); // 확인 메시지
      continue; // 에이전트 실행을 건너뛰고 새 입력을 기다립니다.
    } else if (userInput.toLowerCase() === "/chat") {
      console.log(`
      ✅ 사용 가능한 명령어:
      /save  - 현재까지의 대화 내용을 파일로 저장합니다.
      /list  - 현재까지의 대화 내용을 콘솔에 출력합니다.
      /clear - 현재까지의 대화 내용을 모두 지웁니다.
      /exit  - 프로그램을 종료합니다.
      `);
      continue;
    } else if (userInput.toLowerCase() === "/save") {
      const timestamp = getTimestamp();
      const fileName = `chathistory_${timestamp}.md`;
      const historyData = await memory.loadMemoryVariables({});
      const messages = historyData.chat_history || [];

      if (messages.length === 0) {
        console.log("✅ 채팅 기록이 없습니다.");
        continue;
      }

      let formattedHistory = `# 📝 채팅 기록 (${timestamp})\n\n`;
      for (const message of messages) {
        if (message._getType() === "human") {
          formattedHistory += `**🧑 Human:**\n${message.content}\n\n---\n\n`;
        } else if (message._getType() === "ai") {
          const aiContent = typeof message.content === 'string' ? message.content : JSON.stringify(message.content, null, 2);
          formattedHistory += `**🤖 AI:**\n${aiContent}\n\n---\n\n`;
        }
      }

      try {
        const safePath = getSafePath(fileName);
        await fs.writeFile(safePath, formattedHistory, "utf-8");
        console.log(`✅ 채팅 기록이 '${fileName}' 파일로 저장되었습니다.`);
      } catch (error) {
        console.error("❌ 파일 저장 중 오류가 발생했습니다:", error.message);
      }
      continue;
    } else if (userInput.toLowerCase() === "/list") {
      const historyData = await memory.loadMemoryVariables({});
      const messages = historyData.chat_history || [];

      if (messages.length === 0) {
        console.log("✅ 채팅 기록이 없습니다.");
        continue;
      }

      console.log("\n--- 📝 채팅 기록 ---");
      for (const message of messages) {
        if (message._getType() === "human") {
          console.log(`\n🧑 Human:\n${message.content}`);
        } else if (message._getType() === "ai") {
          const aiContent = typeof message.content === 'string' ? message.content : JSON.stringify(message.content, null, 2);
          console.log(`\n🤖 AI:\n${aiContent}`);
        }
      }
      console.log("\n--- 기록 끝 ---\n");
      continue;
    }

    const controller = new AbortController();
    const sigintHandler = () => {
      console.log("\n[명령어 실행 취소]");
      controller.abort();
    };

    try {
      process.once('SIGINT', sigintHandler);
      // AI 실행 (메모리 수동 관리)
      const history = await memory.loadMemoryVariables({});
      const result = await executor.invoke(
        {
          input: userInput,
          chat_history: history.chat_history,
        },
        { signal: controller.signal }
      );
      await memory.saveContext({ input: userInput }, { output: result.output });

      console.log(`\n🤖: ${result.output}\n`);
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.error("❌ 오류 발생:", error.message);
      }
    } finally {
      process.removeListener('SIGINT', sigintHandler);
    }
  }
}

startCLI();