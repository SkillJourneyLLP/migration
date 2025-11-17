import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    const { candidateId, interviewId } = await req.json();
    if (!candidateId || !interviewId) {
      return new Response(JSON.stringify({
        error: 'candidateId and interviewId are required'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    console.log(`Proxying report generation request for candidate: ${candidateId}, interview: ${interviewId}`);
    // Call the Google Cloud Run function
    const response = await fetch('https://shaurya-interviews-556873855449.asia-south1.run.app', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        candidateId,
        interviewId
      })
    });
    const responseData = await response.json();
    if (!response.ok) {
      console.error('Google Cloud Run function error:', responseData);
      return new Response(JSON.stringify({
        error: responseData.error || 'Failed to generate report'
      }), {
        status: response.status,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    console.log('Report generation request successful');
    return new Response(JSON.stringify(responseData), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Error in generate-report-proxy:', error);
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
