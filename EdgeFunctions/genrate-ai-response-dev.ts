import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};
serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    const body = await req.json().catch(()=>null);
    if (!body) {
      return new Response(JSON.stringify({
        error: "Invalid or missing JSON body"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const { messages, interviewData, timeElapsed } = body;
    const totalDuration = interviewData?.duration || 30;
    const remaining = totalDuration - timeElapsed;
    if (!messages || !interviewData) {
      return new Response(JSON.stringify({
        error: "Missing required fields: messages and interviewData"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // Trim long fields for token efficiency
    const resumeSummary = (interviewData.resumeSummary || "Not provided").slice(0, 1200);
    const jobDescription = (interviewData.jobDescription || "Not provided").slice(0, 2000);
    // Build constraints text only when present
    let constraintsText = "";
    if (Array.isArray(interviewData?.constraints) && interviewData.constraints.length > 0) {
      constraintsText = "\nSpecific Interview Constraints:\n" + interviewData.constraints.map((c)=>`- ${c.type.toUpperCase()}: ${c.difficulty} difficulty${c.topic ? ` Topic: ${c.topic}` : ""}`).join("\n");
    }
    // Conversation history
    const conversationHistory = Array.isArray(messages) ? messages.map((msg)=>`${msg.type === "user" ? "Candidate" : "Interviewer"}: ${msg.content}`).join("\n\n") : "";
    // ---------------- SYSTEM PROMPT ----------------
    // Anti-hallucination focused: no brackets, no meta output, strict output format.
    const systemInstruction = `You are conducting a professional job interview.

General Guidelines:
- The candidate can respond using:
	Speech (voice responses)
	Text Input (typed responses)
	Code Editor (pseudo code)
	
	Encourage use of the most suitable input method depending on the type of question

- Ask thoughtful and relevent questions primarily based on the interview constraints.
- Speak directly as if talking to the candidate face-to-face.
- Ask one question at a time and adapt based on previous answers.
- keep responses conversational and professional.
- use the job description to answer any questions abolt the role, company or responsiblities.

Interview Constraints details:
- The interview constraints can be of 6 types: Technical, coding, resume based, behavorial, screnario based and custom.
- For technical questions, straight away ask a question based on the topic and difficulty level.
- For coding questions,  straight away ask a question based on the topic and difficulty level. Encourage the user of code editor to write the pseudo code.
- For resume-based questions, straight away ask a question based on the topic and difficulty level, referencing the candidate’s resume summary.
- For behavorial questions, straight away ask a question based on the topic and difficulty level. Refer the candidate’s resume summary if required.
- For scenario-based questions, straight away ask a question based on the topic and difficulty level.
- For custom questions, directly ask the question mentioned.
- Covering all interview constraints is a priority.

Strict Response Guidelines:
- Never start your responses with prefixes like: “AI”, “Interviewer”, or any other label.
- Do not provide example answers or suggestions for what the candidate should say.
- Do not answer on behalf of the candidate.
- If some info required to answer candidate’s question is missing then do not invent details. just say that you don’t know.
- Do not include any meta instructions, notes or guidance in the output.

Time Monitoring guidelines:
- Moniitor time closely and begin wrapping when time remaining is 5 minutes or less.
- When time remaining is 2 minutes or less, ask candidate if they have any questions.
- When time remaining is 1 minutes or less, close the interview with a single closing statement and ask the candidate to press the end interview button.
`.trim();
    // ---------------- USER PROMPT ----------------
    // Reworded closing phrasing and removed uppercase commands
    const prompt = `Interview Details:
Position: ${interviewData.position || "Not provided"}

Job Description:
${jobDescription}

Candidate Information:
- Name: ${interviewData.candidateName || "Not provided"}
- Resume Summary: ${resumeSummary}

Interview Constraints:
${constraintsText}

Conversation so far:
${conversationHistory}

${remaining <= 3 ? "End the interview now by thanking the candidate and asking them to click the End Interview button." : "Ask the next interview question now."}`.trim();
    // Debug log for context without leaking candidate content
    console.log(JSON.stringify({
      event: "send_to_gemini",
      position: interviewData.position || null,
      remaining_minutes: remaining
    }));
    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) throw new Error("Missing GEMINI_API_KEY in environment variables");
    // Lower creativity near the end to reduce hallucination
    const temperature = remaining <= 5 ? 0.25 : 0.7;
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: prompt
              }
            ]
          }
        ],
        systemInstruction: {
          role: "system",
          parts: [
            {
              text: systemInstruction
            }
          ]
        },
        generationConfig: {
          temperature,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 512
        }
      })
    });
    if (!response.ok) {
      const errorText = await response.text();
      console.error("Gemini API error:", errorText);
      return new Response(JSON.stringify({
        error: "Gemini API request failed",
        details: errorText
      }), {
        status: response.status,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const data = await response.json();
    // Safer response extraction to handle multiple content shapes
    const aiResponse = data?.candidates?.[0]?.content?.parts?.map((p)=>{
      if (typeof p.text === "string" && p.text.trim()) return p.text.trim();
      if (p.inlineData?.data) return p.inlineData.data;
      return "";
    }).filter(Boolean).join(" ").trim();
    if (!aiResponse) {
      console.error("Invalid Gemini API response:", data);
      throw new Error("Invalid response structure from Gemini API");
    }
    // Final safety check: remove any stray brackets or parentheses the model may have produced
    const sanitizedResponse = aiResponse.replace(/[\[\]\(\)]/g, "").trim();
    // Enforce output is not a meta instruction
    // If sanitizedResponse is empty after sanitization, fail with error
    if (!sanitizedResponse) {
      console.error("Sanitized AI response is empty or invalid");
      throw new Error("AI response invalid after sanitization");
    }
    return new Response(JSON.stringify({
      success: true,
      response: sanitizedResponse
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    console.error("Error in generate-ai-response function:", error);
    return new Response(JSON.stringify({
      error: "Failed to generate AI response",
      details: error.message
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});
