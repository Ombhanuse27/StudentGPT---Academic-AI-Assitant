import Groq from "groq-sdk";
import { Pool } from "pg";

import fs from 'fs';
import path from 'path';
import { extractText } from 'unpdf';

const get_syllabus_from_pdf = async ({ subject, unit }: { subject: string; unit: string }) => {
  try {
    const syllabusPath = path.join(process.cwd(), 'public/TY-CSE-syllabus.pdf');
    if (!fs.existsSync(syllabusPath)) throw new Error(`Syllabus file not found`);

    const buffer = new Uint8Array(fs.readFileSync(syllabusPath));
    const { text: fullText } = await extractText(buffer, { mergePages: true });
    console.log(`🔍 Searching for: "${subject}" - Unit ${unit}`);

    // Normalize subject name for better matching
    const normalizeSubject = (str: string) => {
      return str.toLowerCase()
        .replace(/[^\w\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    };

    const normalizedSearchSubject = normalizeSubject(subject);
    
    // Try multiple subject matching patterns
    const subjectPatterns = [
      new RegExp(`Course\\s+Title\\s*:?\\s*${subject}`, 'i'),
      new RegExp(`${subject}`, 'i'),
      new RegExp(subject.split(' ').join('\\s+'), 'i'),
    ];

    let subjectStartIndex = -1;
    let matchedPattern = null;

    // Find the subject in the text
    for (const pattern of subjectPatterns) {
      const match = fullText.match(pattern);
      if (match) {
        subjectStartIndex = match.index!;
        matchedPattern = pattern;
        break;
      }
    }

    if (subjectStartIndex === -1) {
      // Try fuzzy matching on each line
      const lines = fullText.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (normalizeSubject(lines[i]).includes(normalizedSearchSubject)) {
          subjectStartIndex = fullText.indexOf(lines[i]);
          break;
        }
      }
    }

    if (subjectStartIndex === -1) {
      return `# ❌ Subject Not Found

**"${subject}"** could not be located in the syllabus database.

## 💡 Suggestions:
- **Check the spelling** of the subject name
- Try using the **full subject name** (e.g., "Compiler Design" instead of "CD")
- Verify this subject is part of your curriculum
- Common subjects include: Computer Networks, Operating Systems, Database Management, etc.

📝 **Tip:** You can ask "What subjects are available?" to see the complete list.`;
    }

    // Extract content after subject match
    const afterSubject = fullText.slice(subjectStartIndex);
    
    // Find the next subject/course to limit our search
    const nextCourseMatch = afterSubject.slice(100).match(/Course\s+Title\s*:?/i);
    const searchableText = nextCourseMatch 
      ? afterSubject.slice(0, 100 + nextCourseMatch.index!)
      : afterSubject.slice(0, 5000);

    // Multiple unit matching patterns
    const unitPatterns = [
      // Pattern 1: "Unit 1:" or "Unit I:"
      new RegExp(
        `Unit[\\s-]*${unit}\\s*:([\\s\\S]+?)(?=Unit[\\s-]*(?:\\d+|[IVX]+)\\s*:|Course\\s+Outcomes|Text\\s+Books?|References?|$)`,
        'i'
      ),
      // Pattern 2: "UNIT 1" or "UNIT-1"
      new RegExp(
        `UNIT[\\s-]*${unit}([\\s\\S]+?)(?=UNIT[\\s-]*(?:\\d+|[IVX]+)|Course\\s+Outcomes|Text\\s+Books?|References?|$)`,
        'i'
      ),
      // Pattern 3: Roman numerals (I, II, III, IV, V, VI)
      new RegExp(
        `Unit[\\s-]*${convertToRoman(unit)}\\s*:?([\\s\\S]+?)(?=Unit[\\s-]*(?:\\d+|[IVX]+)|Course\\s+Outcomes|Text\\s+Books?|References?|$)`,
        'i'
      ),
    ];

    let unitContent = null;
    let matchedUnitPattern = null;

    for (const pattern of unitPatterns) {
      const match = searchableText.match(pattern);
      if (match && match[1]) {
        unitContent = match[1];
        matchedUnitPattern = pattern;
        break;
      }
    }

    if (!unitContent) {
      return `# ❌ Unit Not Found

**Unit ${unit}** could not be found for **${subject}**.

## 💡 Common Reasons:
- This unit may not exist for this subject
- Most subjects have **Units 1-6**
- The syllabus structure might be different

### ✅ What You Can Do:
1. **Verify the unit number** (try 1, 2, 3, 4, 5, or 6)
2. **Ask for another unit** from the same subject
3. **Check your course curriculum** for the correct unit structure

📚 Example: *"Show me Unit 1 of ${subject}"*`;
    }

    // Clean and format the content
    let cleanedContent = unitContent
      .trim()
      .replace(/\s+/g, ' ') // Normalize whitespace
      .replace(/(\d+)\s+Hours?/gi, '**$1 Hours**') // Bold hours
      .replace(/^\s*[:;-]\s*/gm, '') // Remove leading punctuation
      .slice(0, 2000); // Limit length

    // Try to extract topics/subtopics
    const lines: string[] = cleanedContent.split(/[,;]/).filter((l: string) => l.trim().length > 5);
    
    let formattedContent = '';
    if (lines.length > 1) {
      formattedContent = '## 📚 Topics Covered:\n\n';
      lines.forEach((line, idx) => {
        const trimmedLine = line.trim();
        if (trimmedLine) {
          formattedContent += `${idx + 1}. ${trimmedLine}\n`;
        }
      });
    } else {
      formattedContent = `## 📚 Content:\n\n${cleanedContent}`;
    }

    // Extract hours if present
    const hoursMatch = unitContent.match(/(\d+)\s*Hours?/i);
    const hours = hoursMatch ? `\n\n⏱️ **Duration:** ${hoursMatch[1]} Hours` : '';

    return `# 📘 ${subject}
## 🎯 Unit ${unit}

${formattedContent}${hours}

---
*💡 The AI will now provide you with smart study tips and strategies for this unit!*`;
    
  } catch (err: any) {
    console.error('PDF parsing error:', err);
    return `# ⚠️ Error Processing Syllabus

**Something went wrong while extracting the syllabus.**

## 🔍 Error Details:
\`${err.message}\`

## 🛠️ Troubleshooting:
- Ensure the syllabus PDF file exists in the correct location
- Check if the PDF is properly formatted and not corrupted
- Try requesting a different subject or unit

If the problem persists, please contact technical support.`;
  }
};

// Helper function to convert numbers to Roman numerals
function convertToRoman(num: string): string {
  const romanNumerals: { [key: string]: string } = {
    '1': 'I', '2': 'II', '3': 'III', '4': 'IV',
    '5': 'V', '6': 'VI', '7': 'VII', '8': 'VIII'
  };
  return romanNumerals[num] || num;
}

export const runtime = 'nodejs';
export const maxDuration = 60;

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY! });

// ✅ PRODUCTION CHANGE: PostgreSQL pool using DATABASE_URL with SSL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 1,
});

async function get_attendance({ roll_number }: any) {
  console.log("parameters to get attendance is : " + roll_number);
  
  try {
    // Validate roll number format
    if (!roll_number || roll_number.toString().trim() === '') {
      return `# ❌ Invalid Roll Number

**Please provide a valid roll number.**

## 📝 Format Examples:
- \`2021001\`
- \`21CSE001\`
- \`CS001\`

**Enter your roll number to check attendance.**`;
    }

    // ✅ PRODUCTION CHANGE: PostgreSQL query with $1 placeholder
    const result = await pool.query(
      "SELECT attendance_percentage, name FROM students WHERE id = $1",
      [roll_number]
    );

    const rows = result.rows;
    
    if (rows.length > 0) {
      const attendance = rows[0].attendance_percentage;
      const studentName = rows[0].name || 'Student';
      
      // Determine attendance status
      let status = '';
      let emoji = '';
      let message = '';
      
      if (attendance >= 75) {
        status = '✅ Excellent';
        emoji = '🎉';
        message = 'Keep up the great work!';
      } else if (attendance >= 65) {
        status = '⚠️ Warning';
        emoji = '⚠️';
        message = 'You need to improve your attendance to meet the 75% requirement.';
      } else {
        status = '❌ Critical';
        emoji = '🚨';
        message = 'Your attendance is critically low! Immediate improvement required.';
      }
      
      // Calculate classes needed to reach 75% (if below)
      let improvementTip = '';
      if (attendance < 75) {
        const classesNeeded = Math.ceil((75 - attendance) / (100 - 75) * 10);
        improvementTip = `\n\n## 💡 Improvement Plan:\n**Attend the next ${classesNeeded}+ classes continuously** to improve your percentage.`;
      }
      
      return `# 📊 Attendance Report

**Student:** ${studentName}  
**Roll Number:** ${roll_number}

---

## ${emoji} Current Attendance

| Metric | Value |
|--------|-------|
| **Percentage** | **${attendance}%** |
| **Status** | ${status} |
| **Required** | 75% (minimum) |

${message}${improvementTip}

---
*📅 Keep attending classes regularly to maintain good academic standing!*`;
    } else {
      return `# ❌ Roll Number Not Found

**Roll Number:** \`${roll_number}\`

## 🔍 This could mean:
- The roll number was entered incorrectly
- You're not registered in the system yet
- There's a typo in the roll number

## ✅ What to do:
1. **Double-check your roll number**
2. **Verify the format** (e.g., 2021001, 21CSE001)
3. **Contact the administration** if the issue persists

**Please verify and try again with the correct roll number.**`;
    }
  } catch (error: any) {
    console.error("Error fetching attendance:", error);
    return `# ⚠️ Database Error

**Unable to retrieve attendance at this moment.**

## 🔧 Technical Details:
\`${error.message}\`

## 💡 Please Try:
- **Wait a moment** and try again
- **Check your internet connection**
- **Contact support** if the issue persists

**We apologize for the inconvenience. Please try again later.**`;
  }
}

// Function to fetch timetable by year and department
async function get_timetable({ year, branch }: any) {
  console.log("parameters to get timetable are : " + year + "  " + branch);
  
  try {
    // Validate inputs
    if (!year || !branch) {
      return `# ❌ Missing Information

**Please provide both year and branch to fetch the timetable.**

## 📝 Required Information:
- **Year:** 1, 2, 3, or 4
- **Branch:** CSE, MECH, CIVIL, etc.

**Example:** *"Show me timetable for 3rd year CSE"*`;
    }

    // ✅ PRODUCTION CHANGE: Explicit integer coercion (pg sends numbers as strings)
    const yearInt = Number(year);
    if (![1, 2, 3, 4].includes(yearInt)) {
      return `# ❌ Invalid Year

**Year "${year}" is not valid.**

## ✅ Valid Years:
- **1** - First Year
- **2** - Second Year
- **3** - Third Year
- **4** - Fourth Year

**Please specify a year between 1 and 4.**`;
    }

    // ✅ PRODUCTION CHANGE: PostgreSQL query with $1/$2 placeholders.
    const result = await pool.query(
      `SELECT day, time_slot, subject
       FROM timetable
       WHERE year = $1 AND branch = $2
       ORDER BY
         CASE day
           WHEN 'Monday'    THEN 1
           WHEN 'Tuesday'   THEN 2
           WHEN 'Wednesday' THEN 3
           WHEN 'Thursday'  THEN 4
           WHEN 'Friday'    THEN 5
           WHEN 'Saturday'  THEN 6
           ELSE 7
         END,
         time_slot`,
      [yearInt, branch]
    );

    const rows = result.rows;

    if (rows.length > 0) {
      // Map year to text
      const yearText = ['First', 'Second', 'Third', 'Fourth'][yearInt - 1];
      
      let timetableText = `# 📅 Class Timetable

**Year:** ${yearText} Year  
**Branch:** ${branch}

---

`;
      let currentDay = "";
      let dayCount = 0;

      rows.forEach(({ day, time_slot, subject }: any) => {
        if (day !== currentDay) {
          if (currentDay !== "") {
            timetableText += '\n';
          }
          timetableText += `## 📆 ${day}\n\n`;
          currentDay = day;
          dayCount++;
        }
        timetableText += `- ⏰ **${time_slot}** → ${subject}\n`;
      });

      timetableText += `\n---\n*📚 Total ${dayCount} days of classes scheduled*\n\n💡 **Tip:** Save this timetable or take a screenshot for quick reference!`;

      return timetableText;
    } else {
      // ✅ PRODUCTION CHANGE: PostgreSQL queries with $1 placeholder for suggestions
      const branchesResult = await pool.query(
        "SELECT DISTINCT branch FROM timetable WHERE year = $1",
        [yearInt]
      );

      const yearsResult = await pool.query(
        "SELECT DISTINCT year FROM timetable WHERE branch = $1",
        [branch]
      );

      const allBranches = branchesResult.rows;
      const allYears = yearsResult.rows;

      let suggestionText = '';
      
      if (allBranches.length > 0) {
        const branches = allBranches.map((r: any) => r.branch).join(', ');
        suggestionText += `\n\n## 📋 Available Branches for Year ${year}:\n${branches}`;
      }
      
      if (allYears.length > 0) {
        const years = allYears.map((r: any) => r.year).join(', ');
        suggestionText += `\n\n## 📋 Available Years for ${branch}:\n${years}`;
      }

      return `# ❌ Timetable Not Found

**No timetable found for:**
- **Year:** ${year}
- **Branch:** ${branch}

## 🔍 Possible Reasons:
- This combination doesn't exist in the database
- The timetable hasn't been uploaded yet
- There might be a spelling error in the branch name
${suggestionText}

## ✅ What You Can Do:
1. **Verify your year and branch**
2. **Check the available options** above
3. **Contact administration** if your timetable should exist

**Please try again with the correct information.**`;
    }
  } catch (error: any) {
    console.error("Error fetching timetable:", error);
    return `# ⚠️ Database Error

**Unable to retrieve timetable at this moment.**

## 🔧 Technical Details:
\`${error.message}\`

## 💡 Please Try:
- **Wait a moment** and try again
- **Check your parameters** (year and branch)
- **Contact support** if the issue persists

**We apologize for the inconvenience. Please try again later.**`;
  }
}

const tools = [
  {
    type: "function" as const,
    function: {
      name: "get_attendance",
      description: "Fetch student attendance based on roll number.",
      parameters: {
        type: "object",
        properties: {
          roll_number: {
            type: "string",
            description: "The student's roll number."
          }
        },
        required: ["roll_number"]
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "get_timetable",
      description: "Fetch the class timetable based on year and branch.",
      parameters: {
        type: "object",
        properties: {
          year: {
            type: "integer",
            description: "The academic year (e.g., 1,2,3)."
          },
          branch: {
            type: "string",
            description: "The branch name (e.g., CSE,MECH,CIVIL)."
          }
        },
        required: ["year", "branch"]
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "get_syllabus_from_pdf",
      description: "Extract unit-wise syllabus from a given subject in the syllabus PDF.",
      parameters: {
        type: "object",
        properties: {
          subject: {
            type: "string",
            description: "The subject name, e.g., 'Compiler Design'"
          },
          unit: {
            type: "string",
            description: "The unit number, e.g., '1', '2', etc."
          }
        },
        required: ["subject", "unit"]
      }
    }
  }
];

const systemMessage = {
  role: "system",
  content: `You are DYPCET AI Assistant, a helpful, polite, and knowledgeable virtual assistant for Dr. D. Y. Patil College of Engineering & Technology (DYPCET).
Your job is to assist students by providing accurate and relevant information about the college.
You have access to certain tools to fetch student-specific data such as attendance and class timetable.
If the users input has some spelling mistakes, please correct them and analyse the tool use required or not.

🧠 Personality & Behavior Guidelines

- Always be polite, respectful, and professional.
- Maintain a friendly and approachable tone, suitable for interacting with college students.
- If a user asks for personal data like attendance or timetable, guide them to provide the required info (e.g., roll number, department, year).
- If a tool call is needed, extract the required information clearly and use the appropriate tool.
- If the user input is unclear, ask clarifying questions before using any tool.
- Avoid making up answers—use tool results wherever applicable.
- If a question is unrelated to the college or your capabilities, politely decline to answer and guide the user accordingly.
- Do not share or assume private data unless explicitly provided by the user.
- ⚠️ Important: When requesting timetable, always convert year to integer (1,2,3,4) and branch to exact database name ("CSE", "MECH", "CIVIL", etc.) before calling get_timetable.

⚠️ Important Database Mapping:
- If user says "CSE" or "Computer Science", use branch: "CSE"
- If user says "Mech" or "Mechanical", use branch: "MECH"
- If user says "Civil", use branch: "CIVIL"
- Ensure the branch name is always UPPERCASE when calling the tool.

Special instruction for syllabus requests:
- When the user requests a unit syllabus, after fetching it from the PDF, generate **custom study tips dynamically** based on the topics extracted.
- The study tips should include: important points to focus on, example/problem practice advice, and revision strategies.
- Make the tips concise, actionable, and relevant to the specific syllabus unit.

⚠️ CRITICAL - Tool Calling Format:
- When calling tools, use ONLY the exact function names provided: get_attendance, get_timetable, get_syllabus_from_pdf
- Do NOT add spaces between function name and parameters

🛠️ Available Tools

You have access to the following tools:

1. **get_attendance**
   - Fetch student attendance by roll number
   - Required: roll_number (string)
   - Returns: Formatted attendance report with status and improvement tips

2. **get_timetable**
   - Fetch class timetable based on year and branch
   - Required: year (integer: 1,2,3,4) and branch (string: CSE, MECH, CIVIL, etc.)
   - Example format: year:1 branch:CSE
   - Returns: Formatted weekly timetable

3. **get_syllabus_from_pdf**
   - Extract unit-wise syllabus from PDF
   - Required: subject (string), unit (string)
   - Returns: Formatted syllabus content with topics
   - After displaying syllabus, provide smart study strategies

Try to strictly generate the response in proper markdown format so that it would render properly on frontend UI.
You can decide the markdown style/design according to the scenario such as generating table, bold heading, etc.
Try to make the chat interactive with adding some emojis and icons as you want.

Stay concise, but helpful.`,
};

const availableFunctions: Record<string, Function> = {
  get_attendance,
  get_timetable,
  get_syllabus_from_pdf,
};

export async function POST(req: Request) {
  const { messages } = await req.json();
  
  const userMessage = messages[messages.length - 1].content;
  console.log("\nUser input:", userMessage, "\n");

  // ✅ Clean the messages to remove any malformed tool calls
  const cleanedMessages = messages.map((msg: any) => {
    if (msg.role === 'assistant' && msg.tool_calls) {
      return {
        role: msg.role,
        content: msg.content || null,
        tool_calls: msg.tool_calls
      };
    }
    return {
      role: msg.role,
      content: msg.content
    };
  });

  const updatedMessages = [systemMessage, ...cleanedMessages];

  try {
    // Call the main LLM to decide tool usage
    const response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: updatedMessages,
      tools: tools,
      tool_choice: "auto",
      max_tokens: 4096,
    });

    const responseMessage = response.choices[0].message;
    const toolCalls = responseMessage.tool_calls;

    if (responseMessage.content != undefined) {
      console.log("First LLM Call Response:", responseMessage.content);
    } else {
      console.log("LLM decided to use tools.");
    }

    // Handle tool calls
    if (toolCalls && toolCalls.length > 0) {
      updatedMessages.push(responseMessage);
      for (const toolCall of toolCalls) {
        const functionName = toolCall.function.name;
        const func = availableFunctions[functionName];
        if (!func) continue;

        const functionArgs = JSON.parse(toolCall.function.arguments);
        const functionResponse = await func(functionArgs);
        console.log(`Tool ${functionName} response:`, functionResponse);

        // ✅ Check if this is a first-time request or a reformatting request
        const isReformatRequest = messages.length > 2 && 
          (userMessage.toLowerCase().includes('table') || 
           userMessage.toLowerCase().includes('format') ||
           userMessage.toLowerCase().includes('different') ||
           userMessage.toLowerCase().includes('show'));

        // ✅ DIRECT RETURN for attendance and timetable (only for first-time requests)
        if ((functionName === "get_attendance" || functionName === "get_timetable") && !isReformatRequest) {
          return new Response(
            JSON.stringify({
              message: {
                role: "assistant",
                content: functionResponse,
                tool_used: functionName,
              },
            }),
            { headers: { "Content-Type": "application/json" } }
          );
        }

        // ✅ SYLLABUS & OTHERS: Append result to history
        updatedMessages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          name: functionName,
          content: typeof functionResponse === 'string' ? functionResponse : JSON.stringify(functionResponse),
        });

        // ✅ Enhanced study tips instruction for syllabus
        if (functionName === "get_syllabus_from_pdf") {
          const syllabusContent = typeof functionResponse === 'string' ? functionResponse : '';
          
          updatedMessages.push({
            role: "user",
            content: `Here is the syllabus that was extracted. Display this EXACT content first, then add study tips below it:

${syllabusContent}

Now, after displaying the above syllabus content EXACTLY as shown (with all topics), add these study guide sections below a separator line (---):

## 🧠 Smart Study Strategy
- Analyze the topics listed and identify which ones are **conceptually challenging** vs **application-based**
- Suggest which topics typically carry more **exam weightage** 
- Recommend the **ideal study sequence** for this unit

## 💡 Key Focus Areas
- List the **3-5 most important concepts** from the topics that students should master
- Explain **why** each concept is crucial
- Provide **real-world applications** where relevant

## 📝 Practice Recommendations
- Suggest **specific types of problems** students should practice based on the topics
- Recommend **2-3 practice questions** based on the topics
- Indicate difficulty level (Easy/Medium/Hard) for each

## 🔄 Revision Strategy
- Provide a **quick revision checklist** for this unit
- Suggest **memory techniques** or **mnemonics** if applicable
- Recommend how to **organize notes** for this unit

## ⏱️ Time Management
- Suggest approximate **study hours** needed for each topic
- Recommend a **week-long study plan** for this unit

IMPORTANT: Start by showing the complete syllabus content above, then add the study sections. Make it motivating and student-friendly!`
          });
        }
      }

      // Second LLM call to incorporate tool results
      try {
        const secondResponse = await groq.chat.completions.create({
          model: "llama-3.3-70b-versatile",
          messages: updatedMessages,
        });

        return new Response(
          JSON.stringify({
            message: {
              ...secondResponse.choices[0].message,
              role: "assistant",
              tool_used: toolCalls[0].function.name,
            },
          }),
          { headers: { "Content-Type": "application/json" } }
        );
      } catch (secondError: any) {
        if (secondError.status === 429) {
          return new Response(
            JSON.stringify({
              message: {
                role: "assistant",
                content: handleRateLimitError(secondError),
              },
            }),
            { headers: { "Content-Type": "application/json" } }
          );
        }
        throw secondError;
      }
    } else {
      // No tool needed
      return new Response(
        JSON.stringify({ message: responseMessage }),
        { headers: { "Content-Type": "application/json" } }
      );
    }
  } catch (error: any) {
    console.error("API Error:", error);
    
    if (error.status === 429) {
      return new Response(
        JSON.stringify({
          message: {
            role: "assistant",
            content: handleRateLimitError(error),
          },
        }),
        { headers: { "Content-Type": "application/json" } }
      );
    }
    
    return new Response(
      JSON.stringify({
        message: {
          role: "assistant",
          content: `# ⚠️ Service Error

**An unexpected error occurred while processing your request.**

## 🔍 Error Details:
\`${error.message || 'Unknown error'}\`

## 💡 What You Can Do:
- **Wait a moment** and try again
- **Simplify your question** if it was complex
- **Contact support** if the issue persists

**We apologize for the inconvenience!**`,
        },
      }),
      { 
        status: 500,
        headers: { "Content-Type": "application/json" } 
      }
    );
  }
}

// Helper function to handle rate limit errors
function handleRateLimitError(error: any): string {
  const errorMessage = error.error?.error?.message || error.message || '';
  
  let waitTime = '5-10 minutes';
  const timeMatch = errorMessage.match(/try again in (.+?)\./i);
  if (timeMatch) {
    waitTime = timeMatch[1];
  }
  
  return `# ⏳ Rate Limit Reached

**Our AI service has reached its usage limit for today.**

## 🔍 What Happened:
The Groq API (our AI provider) has a daily token limit, and we've temporarily exceeded it.

## ⏰ Wait Time:
Please try again in **${waitTime}**

## 💡 What You Can Do Right Now:

### Option 1: Wait & Retry ⏱️
- Come back in **${waitTime}**
- Your question will work then
- All your data is saved

### Option 2: Use Basic Features 📚
While waiting, you can still:
- View the **college information** you already have
- **Browse** previous conversation history
- **Prepare questions** for when the service is back

### Option 3: Contact Support 📞
If this is urgent:
- **Contact college IT support**
- Mention the rate limit issue
- They may have alternative access

---

## 📊 Technical Details:
\`\`\`
${errorMessage}
\`\`\`

**We apologize for the inconvenience! This is a temporary limit that will reset automatically.** 🙏

💡 **Pro Tip:** Our service typically resets daily. Bookmark this chat and come back later!`;
}