import "https://deno.land/x/xhr@0.1.0/mod.ts";
// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
serve(async (req)=>{
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    const { jobDescription, includePsychometric } = await req.json();
    if (!jobDescription) {
      return new Response(JSON.stringify({
        error: 'Job description is required'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) {
      console.error('GEMINI_API_KEY not found');
      return new Response(JSON.stringify({
        error: 'API key not configured'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const psychometricNote = includePsychometric ? ' Additionally, include 2-3 constraints of type "behavioral_assessment" to assess personality traits, cognitive abilities, and emotional intelligence.' : '';
    const typesList = includePsychometric ? '(technical, coding, behavioral, situational, resume_based, custom, behavioral_assessment)' : '(technical, coding, behavioral, situational, resume_based, custom)';
    const prompt = `Based on the following job description, generate 5-8 interview constraints that would be appropriate for evaluating candidates. Each constraint should have a type ${typesList}, a specific topic, and a difficulty level (easy, medium, hard).${psychometricNote}

Job Description:
${jobDescription}

Please respond with a JSON array in this exact format:
[
  {
    "type": "technical",
    "topic": "System Design",
    "difficulty": "medium"
  },
  {
    "type": "behavioral",
    "topic": "Communication Skills",
    "difficulty": "easy"
  }${includePsychometric ? `,
  {
    "type": "behavioral_assessment",
    "topic": "Personality Assessment",
    "difficulty": "medium"
  }` : ''}
]

Make sure the constraints are relevant to the job requirements and cover a good mix of areas. Focus on practical skills mentioned in the job description.`;
    console.log('Making request to Gemini API...');
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-001:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
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
          maxOutputTokens: 1024
        }
      })
    });
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Gemini API error:', errorText);
      throw new Error(`Gemini API error: ${response.status}`);
    }
    const data = await response.json();
    console.log('Gemini API response:', JSON.stringify(data, null, 2));
    if (!data.candidates?.[0]?.content?.parts?.[0]?.text) {
      throw new Error('Invalid response format from Gemini API');
    }
    const generatedText = data.candidates[0].content.parts[0].text;
    console.log('Generated text:', generatedText);
    // Try to extract JSON from the response
    let constraints;
    try {
      // Look for JSON array in the response
      const jsonMatch = generatedText.match(/\[[\s\S]*?\]/);
      if (jsonMatch) {
        constraints = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON array found in response');
      }
    } catch (parseError) {
      console.error('Failed to parse generated constraints:', parseError);
      // Fallback constraints based on job description keywords
      constraints = [
        {
          type: "technical",
          topic: "Core Technologies",
          difficulty: "medium"
        },
        {
          type: "coding",
          topic: "Problem Solving",
          difficulty: "medium"
        },
        {
          type: "behavioral",
          topic: "Teamwork",
          difficulty: "easy"
        },
        {
          type: "resume_based",
          topic: "Project Experience",
          difficulty: "medium"
        },
        {
          type: "technical",
          topic: "System Design",
          difficulty: "hard"
        }
      ];
    }
    return new Response(JSON.stringify({
      success: true,
      constraints
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Error in generate-constraints function:', error);
    return new Response(JSON.stringify({
      error: error.message || 'Internal server error'
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
