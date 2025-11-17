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
    const { messages, interviewData, timeElapsed = 0, timeRemaining } = body;
    const totalDuration = interviewData?.duration || 30; // fallback 30 mins
    const remaining = timeRemaining ?? totalDuration - timeElapsed;
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
    // ✅ Build constraints text from interviewData.constraints and generated questions
    const constraintsText = interviewData?.constraints?.length ? `\nSpecific Interview Constraints to follow: ${interviewData.constraints.map((c)=>`- ${c.type.toUpperCase()}: ${c.difficulty} difficulty${c.topic ? `(Topic: ${c.topic})` : ""}`).join("\n")}` : "";
    // Add generated questions to the prompt if available
    const generatedQuestionsText = interviewData?.generatedQuestions?.constraints?.length ? `\n\nPre-generated Questions (use these as guidance):\n${interviewData.generatedQuestions.constraints.map((c, idx)=>`${idx + 1}. ${c.type} (${c.difficulty})${c.topic ? ` - ${c.topic}` : ''}:\n${c.questions.map((q, qIdx)=>`   ${qIdx + 1}. ${q}`).join('\n')}`).join('\n\n')}` : "";
    // ✅ Build conversation history
    const conversationHistory = messages.map((msg)=>`${msg.type === "user" ? "Candidate" : "Interviewer"}: ${msg.content}`).join("\n\n");
    // ✅ Build AI prompt
    const prompt = `You are conducting a professional job interview for the position of ${interviewData.position}.
Job Description: ${interviewData.jobDescription || "Not provided"}
Candidate Information:
- Name: ${interviewData.candidateName}
- Resume Summary: ${interviewData.resumeSummary || "Not provided"}




Interview Parameters:
- Total Duration: ${interviewData.duration || "Not specified"} minutes
- Time Elapsed: ${timeElapsed} minutes
- Time Remaining: ${remaining} minutes${constraintsText}${generatedQuestionsText}




CRITICAL RESPONSE RULES:
- NEVER start your response with prefixes like "AI:", "Interviewer:", or any other label
- ONLY ask questions or provide closing statements
- do NOT answer on behalf of the candidate
- Speak directly as if you are talking to the candidate face-to-face
- Do NOT provide example answers or suggestions for what the candidate should say
- If you do not get an understandable response from the candidate, or if you only hear background noise, or if a transcription failure occurs, politely inform the candidate and ask them to try again. If successive attempts still fail, instruct the candidate to use the text box instead.




MULTIMODAL INPUT AWARENESS:
The candidate can respond using:
- Speech (voice responses)
- Text input (typed responses)
- Code editor (for coding questions/solutions)
Encourage use of the most suitable input method depending on the type of question.




Interview Guidelines:
- Ask thoughtful, relevant questions primarily based on the  constraints
- The allowed constraint types are Technical, Coding, Behavioral, and Resume-based.
- reference the candidate’s resume only when the constraint type is Behavioral or Resume-based. Do not reference the resume for Technical or Coding questions.
- Follow up on answers with deeper questions
- Keep responses conversational and professional (1–3 sentences max)
- Ask one question at a time and adapt based on previous answers
- For coding questions, encourage use of the code editor
- For complex explanations, suggest text input if helpful
- Use the job description to answer any questions about the role, company, or responsibilities
- IMPORTANT: Monitor time closely — when ${remaining <= 5 ? "CONCLUDE THE INTERVIEW IMMEDIATELY with a closing statement" : remaining <= 10 ? "start wrapping up and ask final questions" : "continue with focused questions"}




Current conversation:
${conversationHistory}




${remaining <= 5 ? 'PROVIDE A PROFESSIONAL CLOSING STATEMENT TO END THE INTERVIEW NOW. Thank the candidate and ask them to click the "End Interview" button to finish.' : "Provide your next interview question or response:"}`;
    console.log("Sending request to Gemini API...");
    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) {
      throw new Error("Missing GEMINI_API_KEY in environment variables");
    }
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: prompt
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.7,
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
    const aiResponse = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!aiResponse) {
      console.error("Invalid Gemini API response:", data);
      throw new Error("Invalid response structure from Gemini API");
    }
    console.log("AI response generated successfully");
    return new Response(JSON.stringify({
      success: true,
      response: aiResponse
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
