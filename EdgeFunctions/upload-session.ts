import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
// Initialize Supabase client
const supabaseUrl = Deno.env.get('SUPABASE_URL');
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const supabase = createClient(supabaseUrl, supabaseServiceKey);
Deno.serve(async (req)=>{
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    const body = await req.json();
    if (body.action === 'create') {
      const { candidateId, interviewId, totalSize } = body;
      // Generate unique session ID and safe filename
      const uploadSessionId = crypto.randomUUID();
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `${interviewId}_${candidateId}_${timestamp}.webm`;
      // Create session in database
      const { data: session, error: sessionError } = await supabase.from('video_upload_sessions').insert({
        candidate_id: candidateId,
        interview_id: interviewId,
        upload_session_id: uploadSessionId,
        file_name: fileName,
        total_size: totalSize,
        uploaded_size: 0,
        chunk_count: 0,
        status: 'pending'
      }).select().single();
      if (sessionError) {
        console.error('Error creating upload session:', sessionError);
        throw sessionError;
      }
      // Extract project ref from Supabase URL
      const projectRef = supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
      if (!projectRef) {
        throw new Error('Could not extract project ref from Supabase URL');
      }
      return new Response(JSON.stringify({
        success: true,
        uploadSessionId,
        fileName,
        bucketName: 'video-recordings',
        tusEndpoint: `https://${projectRef}.supabase.co/storage/v1/upload/resumable`
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    } else if (body.action === 'finalize') {
      const { uploadSessionId } = body;
      // Fetch session from database
      const { data: session, error: sessionError } = await supabase.from('video_upload_sessions').select('*').eq('upload_session_id', uploadSessionId).single();
      if (sessionError || !session) {
        console.error('Error fetching upload session:', sessionError);
        throw new Error('Upload session not found');
      }
      // Mark session as completed
      const { error: updateError } = await supabase.from('video_upload_sessions').update({
        status: 'completed'
      }).eq('upload_session_id', uploadSessionId);
      if (updateError) {
        console.error('Error updating session status:', updateError);
        throw updateError;
      }
      // Get public URL for the uploaded file
      const { data: publicUrl } = supabase.storage.from('video-recordings').getPublicUrl(session.file_name);
      // Update transcripts table with video URL
      const { error: transcriptError } = await supabase.from('transcripts').update({
        video_recording_url: publicUrl.publicUrl
      }).eq('candidate_id', session.candidate_id).eq('interview_id', session.interview_id);
      if (transcriptError) {
        console.error('Error updating transcript with video URL:', transcriptError);
      // Don't throw here - the upload was successful even if transcript update failed
      }
      console.log(`Video upload finalized for ${session.file_name}`);
      return new Response(JSON.stringify({
        success: true,
        videoUrl: publicUrl.publicUrl,
        fileName: session.file_name
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    } else {
      throw new Error('Invalid action parameter');
    }
  } catch (error) {
    console.error('Upload session error:', error);
    return new Response(JSON.stringify({
      error: error.message || 'Session management failed',
      details: error
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
