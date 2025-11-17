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
    const { userMessage, interviewData, conversationHistory = [] } = body;
    if (!userMessage || !interviewData) {
      return new Response(JSON.stringify({
        error: "Missing required fields: userMessage and interviewData"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // Create conversation context from history
    let conversationContext = "";
    if (conversationHistory.length > 0) {
      conversationContext = conversationHistory.map((msg)=>`${msg.type === 'user' ? 'Candidate' : 'AI'}: ${msg.content}`).join('\n') + '\n';
    }
    // Enhanced conversational prompt for natural walkthrough experience
    const prompt = `You are an AI interview assistant conducting a friendly pre-interview walkthrough with ${interviewData.candidateName} for the ${interviewData.position} position. Speak naturally as if you're having a face-to-face conversation.

INTERVIEW CONTEXT:
- Candidate: ${interviewData.candidateName}
- Position: ${interviewData.position}
- Duration: ${interviewData.duration} minutes
- This is a practice session before the actual recorded interview

${conversationContext ? `CONVERSATION HISTORY:\n${conversationContext}` : ''}

CURRENT USER MESSAGE: "${userMessage}"

CONVERSATION GUIDELINES:
1. **Be Conversational**: Speak naturally like you're sitting across from them. Use "you" and "I" naturally.
2. **Listen Actively**: Address their specific questions directly. If they ask about something, explain it clearly.
3. **Never Assume**: Don't speak for the candidate or assume what they're thinking. Only respond to what they actually say.
4. **Platform Walkthrough Flow**:
   - First interaction: Warmly greet them, explain this is practice time, and give overview of platform features
   - Show them: video feed, microphone controls, text editor, code editor if relevant, submit button
   - Let them ask questions and explore
   - When they seem ready, guide them to start the actual interview
5. **Natural Progression**: 
   - Start with basics, then answer their questions
   - Don't rush them - let them set the pace
   - When conversation naturally winds down, suggest they're ready to begin
6. **End Naturally**: When appropriate (not in every message), mention "When you feel comfortable with everything, go ahead and click Start Interview to begin the real thing!"

RESPONSE STYLE:
- Keep responses 1-3 sentences unless explaining complex features
- Be encouraging and supportive
- Maintain professional yet friendly tone
- Don't repeat the same information unless they ask again

Respond only with what you would say to the candidate:`;
    console.log("Sending request to Gemini API for walkthrough response...");
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
          maxOutputTokens: 300
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
    console.log("Walkthrough AI response generated successfully");
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
    console.error("Error in generate-walkthrough-response function:", error);
    return new Response(JSON.stringify({
      error: "Failed to generate walkthrough response",
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
