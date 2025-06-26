const { ESLint } = require("eslint");

async function testESLintParsers() {
  console.log("Testing ESLint with different file types...\n");

  // Test JavaScript file
  const jsContent = `
function testFunction() {
    var x = 5;
    if (x == 5) {
        console.log('test');
    }
}
`;

  // Test TypeScript file
  const tsContent = `
interface TestInterface {
    name: string;
    age: number;
}

function testFunction(name: string): string {
    const x: number = 5;
    if (x === 5) {
        console.log('test');
    }
    return name;
}
`;

  // Test JSX file
  const jsxContent = `
import React from 'react';

function TestComponent() {
    const [count, setCount] = React.useState(0);
    
    return (
        <div>
            <p>Count: {count}</p>
            <button onClick={() => setCount(count + 1)}>
                Increment
            </button>
        </div>
    );
}
`;

  // Test file with parsing error (import in non-module context)
  const parsingErrorContent = `
import React from 'react';

const [prevPathname, setPrevPathname] = useState<string>();

function TestComponent() {
    return <div>Test</div>;
}
`;

  // Test .js file with TypeScript syntax (should be detected as TypeScript)
  const jsWithTsContent = `
import React from 'react';

interface Props {
    name: string;
    age: number;
}

function TestComponent(props: Props): JSX.Element {
    const [count, setCount] = React.useState<number>(0);
    
    return (
        <div>
            <p>Hello {props.name}, age: {props.age}</p>
            <p>Count: {count}</p>
            <button onClick={() => setCount(count + 1)}>
                Increment
            </button>
        </div>
    );
}
`;

  // Test TypeScript JSX file
  const tsxContent = `
import React, { useState } from 'react';

interface UserProps {
    name: string;
    email: string;
}

const UserComponent: React.FC<UserProps> = ({ name, email }) => {
    const [isActive, setIsActive] = useState<boolean>(false);
    
    const handleClick = (): void => {
        setIsActive(!isActive);
    };
    
    return (
        <div className={isActive ? 'active' : 'inactive'}>
            <h2>{name}</h2>
            <p>{email}</p>
            <button onClick={handleClick}>
                Toggle Status
            </button>
        </div>
    );
};

export default UserComponent;
`;

  const testCases = [
    { content: jsContent, file: "test.js", type: "JavaScript" },
    { content: tsContent, file: "test.ts", type: "TypeScript" },
    { content: jsxContent, file: "test.jsx", type: "JSX" },
    {
      content: parsingErrorContent,
      file: "test-error.js",
      type: "Parsing Error Test",
    },
    {
      content: jsWithTsContent,
      file: "test-js-with-ts.js",
      type: "JS with TS syntax",
    },
    { content: tsxContent, file: "test.tsx", type: "TypeScript JSX" },
  ];

  for (const testCase of testCases) {
    console.log(`=== Testing ${testCase.type} ===`);

    try {
      const fileExtension = testCase.file.split(".").pop()?.toLowerCase();
      const detectedType = detectFileType(fileExtension, testCase.content);
      const eslint = createESLintInstance(detectedType);

      const results = await eslint.lintText(testCase.content, {
        filePath: testCase.file,
      });

      console.log(`File: ${testCase.file} (detected as .${detectedType})`);
      console.log(`Issues found: ${results[0]?.messages.length || 0}`);

      if (results[0]?.messages.length > 0) {
        console.log("Issues:");
        results[0].messages.forEach((msg, index) => {
          const isParsingError = msg.message.includes("Parsing error");
          const severity = isParsingError
            ? "PARSING ERROR"
            : msg.severity === 2
            ? "ERROR"
            : msg.severity === 1
            ? "WARNING"
            : "INFO";
          console.log(
            `  ${index + 1}. [${severity}] Line ${msg.line}: ${msg.message} (${
              msg.ruleId || "eslint"
            })`
          );
        });
      } else {
        console.log("No issues found");
      }
    } catch (error) {
      console.log(`Error: ${error.message}`);
    }

    console.log("");
  }
}

function createESLintInstance(fileExtension) {
  console.log(`Creating ESLint instance for .${fileExtension} files`);

  // Default configuration for JavaScript files
  let config = {
    baseConfig: {
      rules: {
        "no-unused-vars": "warn",
        "no-console": "warn",
        "prefer-const": "warn",
        "no-var": "error",
        eqeqeq: "error",
        curly: "warn",
        "no-eval": "error",
        "no-implied-eval": "error",
        "no-new-func": "error",
        "no-script-url": "error",
      },
    },
  };

  // Configure based on file type
  switch (fileExtension) {
    case "ts":
    case "tsx":
      config = {
        baseConfig: {
          parser: "@typescript-eslint/parser",
          parserOptions: {
            ecmaVersion: 2020,
            sourceType: "module",
            ecmaFeatures: {
              jsx: fileExtension === "tsx",
            },
          },
          plugins: ["@typescript-eslint"],
          rules: {
            "no-unused-vars": "off",
            "@typescript-eslint/no-unused-vars": "warn",
            "no-console": "warn",
            "prefer-const": "warn",
            "no-var": "error",
            eqeqeq: "error",
            curly: "warn",
            "no-eval": "error",
            "no-implied-eval": "error",
            "no-new-func": "error",
            "no-script-url": "error",
          },
        },
      };
      break;

    case "jsx":
      config = {
        baseConfig: {
          parserOptions: {
            ecmaVersion: 2020,
            sourceType: "module",
            ecmaFeatures: {
              jsx: true,
            },
          },
          plugins: ["react"],
          rules: {
            "no-unused-vars": "warn",
            "no-console": "warn",
            "prefer-const": "warn",
            "no-var": "error",
            eqeqeq: "error",
            curly: "warn",
            "no-eval": "error",
            "no-implied-eval": "error",
            "no-new-func": "error",
            "no-script-url": "error",
            "react/jsx-uses-react": "warn",
            "react/jsx-uses-vars": "warn",
          },
        },
      };
      break;

    case "js":
    default:
      // Use default config for .js files
      break;
  }

  return new ESLint(config);
}

function detectFileType(fileExtension, content) {
  console.log(`Detecting file type for .${fileExtension} files`);

  const ext = fileExtension || "js";

  // Check for TypeScript syntax in content
  const hasTypeScriptSyntax =
    content.includes(": string") ||
    content.includes(": number") ||
    content.includes(": boolean") ||
    content.includes(": any") ||
    content.includes("interface ") ||
    content.includes("type ") ||
    content.includes("enum ") ||
    content.includes("namespace ") ||
    content.includes("declare ") ||
    content.includes("as ") ||
    content.includes("<>") ||
    content.includes("extends ") ||
    content.includes("implements ");

  // Check for JSX syntax
  const hasJSX =
    content.includes("<") &&
    content.includes(">") &&
    (content.includes("</") ||
      content.includes("/>") ||
      content.includes("return"));

  // Check for ES6 modules
  const hasES6Modules =
    content.includes("import ") || content.includes("export ");

  // Determine the best file type
  if (hasTypeScriptSyntax) {
    if (hasJSX) {
      console.log(`Detected TypeScript JSX for .${ext} file`);
      return "tsx";
    } else {
      console.log(`Detected TypeScript for .${ext} file`);
      return "ts";
    }
  } else if (hasJSX) {
    console.log(`Detected JSX for .${ext} file`);
    return "jsx";
  } else if (hasES6Modules && ext === "js") {
    console.log(`Detected ES6 modules in .${ext} file`);
    return "mjs";
  } else {
    console.log(`Using extension-based detection for .${ext} file`);
    return ext;
  }
}

testESLintParsers().catch(console.error);
