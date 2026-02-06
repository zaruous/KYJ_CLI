#!/usr/bin/env node
import { ChatOpenAI } from "@langchain/openai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOllama } from "@langchain/ollama";
import { AgentExecutor, createStructuredChatAgent } from "@langchain/classic/agents";
import { BufferMemory } from "@langchain/classic/memory";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import inquirer from "inquirer";
import search from "./search/search/dist/index.js";
import fs from "fs/promises";
import path from "path";
import 'dotenv/config';
import { spawn } from "child_process";
import { glob } from 'glob';
import chalk from 'chalk';
import { Command } from 'commander';
import os from 'os';

// =========================================================
// [1] 보안 및 유틸리티
// =========================================================
let BASE_DIR = process.cwd();
const HISTORY_FILE = path.join(os.homedir(), '.kyj_cli_history');

function getSafePath(targetPath) {
  const resolvedPath = path.resolve(BASE_DIR, targetPath);
  if (!resolvedPath.startsWith(BASE_DIR)) {
    throw new Error("보안 경고: 현재 작업 디렉터리를 벗어난 파일에는 접근할 수 없습니다.");
  }
  return resolvedPath;
}

function getTimestamp() {
  const now = new Date();
  return now.toISOString().replace(/[:.]/g, '-') ;
}

// =========================================================
// [2] 명령어 이력 관리
// =========================================================
let commandHistory = [];
async function loadHistory() {
  try {
    const historyData = await fs.readFile(HISTORY_FILE, 'utf-8');
    commandHistory = historyData.split('\n').filter(line => line.trim() !== '');
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error(chalk.red('명령어 히스토리 로딩 실패:'), error);
    }
    commandHistory = [];
  }
}

async function saveHistory(command) {
    commandHistory.push(command);
    if (commandHistory.length > 100) { // 최근 100개만 저장
        commandHistory.shift();
    }
    try {
        await fs.appendFile(HISTORY_FILE, command + '\n', 'utf-8');
    } catch (error) {
        console.error(chalk.red('명령어 히스토리 저장 실패:'), error);
    }
}


// =========================================================
// [3] 도구 정의
// =========================================================
const tools = [
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
  new DynamicStructuredTool({
    name: "execute_shell_command",
    description: "터미널(셸) 명령어를 실행하고 결과를 반환합니다. ipconfig, ls, pwd, date 같은 시스템 확인용 명령에 사용하세요.",
    schema: z.object({
      command: z.string().describe("실행할 셸 명령어 (예: ipconfig)"),
    }),
    func: async ({ command }) => {
      const blocklist = ["rm", "del", "sudo", "su", "shutdown", "reboot"];
      const commandBase = command.split(" ")[0];
      if (blocklist.includes(commandBase)) {
        return `에러: 보안상의 이유로 '${commandBase}' 명령어는 실행할 수 없습니다.`
      }
      console.log(chalk.gray(`[툴 실행] 셸 명령어 실행: ${command}`));
      return new Promise((resolve) => {
        //const child = spawn(command, { shell: true, stdio: 'pipe' });
          const child = spawn(command, {
              shell: 'powershell.exe',
              cwd: BASE_DIR
          });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (data) => { stdout += data.toString('utf-8'); });
        child.stderr.on('data', (data) => { stderr += data.toString('utf-8'); });
        child.on('close', (code) => {
          let output = `종료 코드: ${code}\n`;
          if (stdout.trim()) {
            output += `STDOUT:\n${stdout.trim()}\n`;
          }
          if (stderr.trim()) {
            output += `STDERR:\n${stderr.trim()}\n`;
          }

          if (code === 0) {
            resolve(`명령어 실행 성공:\n${output}`);
          } else {
            resolve(`명령어 실행 중 에러 발생:\n${output}`);
          }
        });
        child.on('error', (err) => resolve(`명령어 실행 실패: ${err.message}`));
      });
    },
  }),
];

// =========================================================
// [4] 모델 및 에이전트 설정
// =========================================================
function getModel(provider) {
  if (provider === 'gemini') {
      //return new ChatGoogleGenerativeAI({ model: "gemini-3-flash-preview", apiKey: process.env.GOOGLE_API_KEY, temperature: 0 });
      return new ChatGoogleGenerativeAI({ model: "gemini-2.5-flash", apiKey: process.env.GOOGLE_API_KEY, temperature: 0 });
  } else if (provider === 'llama') {
    return new ChatOllama({ baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434", model: process.env.OLLAMA_MODEL || "gemma2:9b", temperature: 0 });
  } else {
    return new ChatOpenAI({ modelName: "gpt-4o", apiKey: process.env.OPENAI_API_KEY, temperature: 0 });
  }
}

const memory = new BufferMemory({ memoryKey: "chat_history", returnMessages: true });
const promptTemplate = ChatPromptTemplate.fromMessages([
  ['system', `You are a helpful assistant. You have access to tools. Your job is to help the user with their requests. The user is a developer. You should respond in Korean.

You have access to the following tools:

{tools}

To use a tool, please use the following format. The 'action' should be one of [{tool_names}].
 The "action_input" MUST be a JSON object, with keys matching the arguments of the tool.

For example:
{{
	"action": "tool_name",
	"action_input": {{
		"arg_name": "arg_value"
	}}
}}

When you have a response to say to the Human, or if you do not need to use a tool, you MUST use the format:
{{
	"action": "Final Answer",
	"action_input": "<your response here>"
}}
`],
  new MessagesPlaceholder("chat_history"),
  ["human", "{input}"],
  new MessagesPlaceholder({ variableName: "agent_scratchpad", optional: true }),
]);

async function createAgentExecutor() {
    const model = getModel('gemini');
    const agent = await createStructuredChatAgent({ llm: model, tools:tools, prompt: promptTemplate });
    return new AgentExecutor({
        agent,
        tools: tools,
        verbose: false, // 이 주석을 풀면 AI의 생각 과정(로그)을 다 볼 수 있습니다.
        maxIterations: 10, // 연쇄 실행 제한걸기
        // Node.js에서는 시간 제한을 AbortSignal로 관리하거나 별도 로직으로 처리합니다.
        handleParsingErrors: true, // Python의 handle_parsing_errors=True
        max_execution_time : 10 //실행 루프에 소요될 수 있는 최대 시간
    });
}


// =========================================================
// [5] 메인 CLI 로직
// =========================================================
async function startCLI() {
  await loadHistory();
  const executor = await createAgentExecutor();
  const program = new Command();

  program.exitOverride();

    console.log(chalk.blue.bold(`
 _  __ __   __     _   ____ _     ___ 
| |/ / \\ \\ / /    | | / ___| |   |_ _|
| ' /   \\ V /  _  | || |   | |    | | 
| . \\    | |  | |_| || |___| |___ | | 
|_|\\_\\   |_|   \\___/  \\____|_____|___|
`));
  console.log(chalk.green("KYJ CLI에 오신 것을 환영합니다! '/help'를 입력해 명령어를 확인하세요."));

  const handleChat = async (userInput) => {
    if (!userInput.trim()) {
        askQuestion();
        return;
    }
    await saveHistory(userInput);

    const controller = new AbortController();
    const sigintHandler = () => {
      console.log(chalk.yellow("\n[명령어 실행 취소]"));
      controller.abort();
    };

    try {
      process.once('SIGINT', sigintHandler);
      const history = await memory.loadMemoryVariables({});
      const result = await executor.invoke({ input: userInput, chat_history: history.chat_history }, { signal: controller.signal });
      await memory.saveContext({ input: userInput }, { output: result.output });
      console.log(`\n${chalk.blue.bold('🤖:')} ${result.output}\n`);
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.error(chalk.red("❌ 오류 발생:"), error.message);
      }
    } finally {
      process.removeListener('SIGINT', sigintHandler);
      askQuestion();
    }
  };

  program
    .command('/clear')
    .description('현재까지의 대화 내용을 모두 지웁니다.')
    .action(async () => {
        await memory.clear();
        console.log(chalk.yellow("✅ 채팅 기록이 지워졌습니다."));
        //await saveHistory('/clear');
        askQuestion();
    });

  program
    .command('/basedir <path>')
    .description('작업 디렉터리(BASE_DIR)를 변경합니다.')
    .action(async (newPath) => {
        try {
            const absolutePath = path.resolve(BASE_DIR, newPath);
            const stats = await fs.stat(absolutePath);
            if (stats.isDirectory()) {
                BASE_DIR = absolutePath;
                console.log(chalk.yellow(`✅ BASE_DIR이 변경되었습니다: ${BASE_DIR}`));
            } else {
                console.error(chalk.red("❌ 오류: 지정한 경로가 디렉터리가 아닙니다."));
            }
        } catch (error) {
            console.error(chalk.red(`❌ 오류: 경로를 찾을 수 없거나 접근할 수 없습니다: ${error.message}`));
        }
        await saveHistory(`/basedir ${newPath}`);
        askQuestion();
    });

  program
    .command('/save')
    .description('현재까지의 대화 내용을 Markdown 파일로 저장합니다.')
    .action(async () => {
        const timestamp = getTimestamp();
        const fileName = `chathistory_${timestamp}.md`;
        const historyData = await memory.loadMemoryVariables({});
        const messages = historyData.chat_history || [];

        if (messages.length === 0) {
            console.log(chalk.yellow("✅ 채팅 기록이 없습니다."));
        } else {
            let formattedHistory = `# 📝 채팅 기록 (${timestamp})\n\n`;
            messages.forEach(message => {
                const type = message._getType();
                const content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content, null, 2);
                if (type === "human") formattedHistory += `**🧑 Human:**\n${content}\n\n---\n\n`;
                else if (type === "ai") formattedHistory += `**🤖 AI:**\n${content}\n\n---\n\n`;
            });

            try {
                const safePath = getSafePath(fileName);
                await fs.writeFile(safePath, formattedHistory, "utf-8");
                console.log(chalk.yellow(`✅ 채팅 기록이 '${safePath}' 파일로 저장되었습니다.`));
            } catch (error) {
                console.error(chalk.red("❌ 파일 저장 중 오류가 발생했습니다:"), error.message);
            }
        }
        await saveHistory('/save');
        askQuestion();
    });
    
    program
        .command('/list')
        .description('현재까지의 대화 내용을 콘솔에 출력합니다.')
        .action(async () => {
            const historyData = await memory.loadMemoryVariables({});
            const messages = historyData.chat_history || [];

            if (messages.length === 0) {
                console.log(chalk.yellow("✅ 채팅 기록이 없습니다."));
            } else {
                console.log(chalk.bold("\n--- 📝 채팅 기록 ---"));
                messages.forEach(message => {
                    const type = message._getType();
                    const content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content, null, 2);
                    if (type === "human") console.log(`\n🧑 Human:\n${content}`);
                    else if (type === "ai") console.log(`\n${chalk.blue.bold('🤖 AI:')}\n${content}`);
                });
                console.log(chalk.bold("\n--- 기록 끝 ---\n"));
            }
            await saveHistory('/list');
            askQuestion();
        });


    program
        .command('/exit')
        .description('CLI 에이전트를 종료합니다.')
        .action(() => {
            console.log(chalk.yellow("프로그램을 종료합니다. 안녕히 계세요!"));
            process.exit(0);
        });

    const handleAttach = async (rawInput) => {
        await saveHistory(rawInput);
        let initialSearch = "";
        const firstWord = rawInput.split(' ')[0];
        if (firstWord.length > 1) {
            initialSearch = firstWord.substring(1).trim();
        }

        const selectedFile = await selectFile(initialSearch);
        if (!selectedFile) {
            console.log(chalk.yellow("파일이 선택되지 않았습니다."));
            askQuestion();
            return;
        }

        try {
            const safePath = getSafePath(selectedFile);
            let fileContent = await fs.readFile(safePath, "utf-8");
            const MAX_FILE_SIZE = 1000000; // 1MB
            if (fileContent.length > MAX_FILE_SIZE) {
                console.log(chalk.yellow(`경고: 파일 크기가 ${MAX_FILE_SIZE / 1000000}MB를 초과하여 앞부분만 사용합니다.`));
                fileContent = fileContent.substring(0, MAX_FILE_SIZE) + "\n... (파일 내용이 너무 길어 뒷부분이 잘렸습니다)";
            }
            
            const { question } = await inquirer.prompt([{ type: "input", name: "question", message: chalk.cyan(`'${selectedFile}' 파일에 대해 질문하세요:`) }]);
            
            if (!question) {
                console.log(chalk.yellow("질문이 입력되지 않았습니다."));
                askQuestion();
                return;
            }

            const combinedInput = '다음 파일 내용을 참고하여 질문에 답해주세요:\n\n[파일: ' + selectedFile + ']\n```\n' + fileContent + '\n```\n\n[질문]\n' + question;
            await handleChat(combinedInput);

        } catch (error) {
            console.error(chalk.red(`❌ '${selectedFile}' 파일 읽기 오류:`), error.message);
            askQuestion();
        }
    };
    
  const askQuestion = async () => {
    try {
      const { userInput } = await inquirer.prompt([
        {
          type: "input",
          name: "userInput",
          message: chalk.green.bold("KYJ_AI >"),
          
        },
      ]);
      
      const args = userInput.trim().split(' ');
      const firstArg = args[0];

      if (firstArg.startsWith('/')) {
        try {
          program.parse(args, { from: 'user' });
        } catch (e) {
           if (e.code !== 'commander.executeSubCommandAsync' && e.code !== 'commander.unknownCommand') {
               console.error(chalk.red(`명령어 처리 중 오류: ${e.message}`));
               askQuestion();
           }
        }
      }
      else if(firstArg.startsWith("@"))
      {
          await handleAttach(userInput);
          /*program.on('command:*', async (operands) => {
              const command = operands.join(' ');
              if (command.startsWith('@')) {

              } else {
                  await handleChat(command);
              }
          });
          */
      }
      else {
        await handleChat(userInput);
      }

    } catch (error) {
      if (error && error.name === 'ExitPromptError') {
        const { confirmExit } = await inquirer.prompt([{ type: 'confirm', name: 'confirmExit', message: '정말로 종료하시겠습니까?', default: true }]);
        if (confirmExit) {
          console.log(chalk.yellow("프로그램을 종료합니다. 안녕히 계세요!"));
          process.exit(0);
        } else {
          askQuestion();
        }
      } else {
        console.error(chalk.red('오류 발생:'), error);
        askQuestion();
      }
    }
  };

  if (process.argv.slice(2).length > 0) {
    program.parse(process.argv);
  } else {
    askQuestion();
  }
}

async function selectFile(initialInput = '') {
  const allFiles = await glob('**/*', { 
    cwd: BASE_DIR,
    ignore: ['node_modules/**', '.git/**', '*.env', '**/node_modules/**', '**/.git/**', '.m2/**', '.idea/**'] 
  });
  const initialFiles = initialInput ? allFiles.filter(f => f.toLowerCase().includes(initialInput.toLowerCase())) : allFiles;

  return await search({
    message: '첨부할 파일을 선택하세요:',
    source: async (input) => {
      if (input === undefined) return initialFiles;
      if (!input) return allFiles;
      return allFiles.filter(f => f.toLowerCase().includes(input.toLowerCase()));
    },
  });
}

startCLI();