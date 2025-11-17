import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    const { interviewId, candidateId } = await req.json();
    if (!interviewId || !candidateId) {
      return new Response(JSON.stringify({
        error: 'Missing interviewId or candidateId'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const bucketName = 'shaurya-interview-recordings';
    const fileName = `${interviewId}-${candidateId}.webm`;
    // Get Google Cloud credentials from secrets
    const projectId = Deno.env.get('GOOGLE_CLOUD_PROJECT');
    const accessToken = Deno.env.get('GOOGLE_ACCESS_TOKEN');
    if (!projectId || !accessToken) {
      throw new Error('Missing Google Cloud credentials');
    }
    // Initiate resumable upload session
    const initiateUrl = `https://storage.googleapis.com/upload/storage/v1/b/${bucketName}/o?uploadType=resumable&name=${encodeURIComponent(fileName)}`;
    const initiateResponse = await fetch(initiateUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-Upload-Content-Type': 'video/webm'
      },
      body: JSON.stringify({
        name: fileName,
        contentType: 'video/webm'
      })
    });
    if (!initiateResponse.ok) {
      const errorText = await initiateResponse.text();
      console.error('GCS initiate error:', errorText);
      throw new Error(`Failed to initiate resumable upload: ${initiateResponse.status}`);
    }
    // Get the resumable upload URL from Location header
    const uploadUrl = initiateResponse.headers.get('Location');
    if (!uploadUrl) {
      throw new Error('No upload URL received from GCS');
    }
    console.log('Resumable upload URL created for:', fileName);
    return new Response(JSON.stringify({
      success: true,
      uploadUrl,
      fileName
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Error creating resumable upload URL:', error);
    return new Response(JSON.stringify({
      error: error.message,
      success: false
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
