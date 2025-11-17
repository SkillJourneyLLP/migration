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
    const { jobDescription } = await req.json();
    if (!jobDescription) {
      return new Response(JSON.stringify({
        error: 'Job description is required'
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        },
        status: 400
      });
    }
    const geminiApiKey = Deno.env.get('GEMINI_API_KEY');
    if (!geminiApiKey) {
      return new Response(JSON.stringify({
        error: 'Gemini API key not configured'
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        },
        status: 500
      });
    }
    const prompt = `Based on the following job description, generate 5-7 evaluation criteria for technical interviews. Each criteria should be relevant to the role and include a suggested weightage percentage. The total should add up to 100%.

Job Description:
${jobDescription}

Please respond with a JSON array of objects with this structure:
[
  {
    "criteria_name": "string",
    "weightage": number
  }
]

Focus on technical and professional skills relevant to the role. Make sure weightages are realistic and sum to 100.`;
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${geminiApiKey}`, {
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
          temperature: 0.3,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 1024
        }
      })
    });
    if (!response.ok) {
      console.error('Gemini API error:', await response.text());
      return new Response(JSON.stringify({
        error: 'Failed to generate criteria'
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        },
        status: 500
      });
    }
    const data = await response.json();
    const generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!generatedText) {
      return new Response(JSON.stringify({
        error: 'No response from Gemini'
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        },
        status: 500
      });
    }
    // Try to parse the JSON from the response
    let criteria;
    try {
      // Extract JSON from the response (remove markdown formatting if present)
      const jsonMatch = generatedText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        criteria = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in response');
      }
    } catch (parseError) {
      console.error('Failed to parse Gemini response:', parseError);
      // Fallback to default criteria if parsing fails
      criteria = [
        {
          criteria_name: "Technical Skills",
          weightage: 30
        },
        {
          criteria_name: "Problem Solving",
          weightage: 25
        },
        {
          criteria_name: "Communication",
          weightage: 20
        },
        {
          criteria_name: "Experience Relevance",
          weightage: 15
        },
        {
          criteria_name: "Cultural Fit",
          weightage: 10
        }
      ];
    }
    return new Response(JSON.stringify({
      criteria
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Error in generate-criteria function:', error);
    return new Response(JSON.stringify({
      error: 'Internal server error'
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 500
    });
  }
});
