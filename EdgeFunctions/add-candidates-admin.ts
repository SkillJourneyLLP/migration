import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
// Function to generate resume summary using resume-summary edge function
async function generateResumeSummary(supabaseClient, pdfBase64) {
  try {
    const { data: resumeData, error: resumeError } = await supabaseClient.functions.invoke('process-resume-pdf', {
      body: {
        pdfBase64: pdfBase64
      }
    });
    if (resumeError || !resumeData?.success) {
      console.error('Error processing resume:', resumeError);
      return '';
    }
    return resumeData.resumeSummary || '';
  } catch (error) {
    console.error('Error generating resume summary:', error);
    return '';
  }
}
// Function to generate username
function generateUsername() {
  const timestamp = Date.now().toString(36);
  const randomString = Math.random().toString(36).substring(2, 8);
  const username = `user_${timestamp}_${randomString}`;
  return username;
}
// Function to generate interview link
async function generateInterviewLink(supabaseClient, username) {
  try {
    const { data: linkData, error: linkError } = await supabaseClient.functions.invoke('generate-interview-link', {
      body: {
        username
      }
    });
    if (linkError || !linkData?.success) {
      console.error('Error generating interview link:', linkError);
      return '';
    }
    return linkData.link || '';
  } catch (error) {
    console.error('Error generating interview link:', error);
    return '';
  }
}
// Function to upload resume to storage
async function uploadResumeToStorage(supabaseClient, interviewId, email, pdfBase64) {
  try {
    // Convert base64 to blob
    const base64Data = pdfBase64.includes(',') ? pdfBase64.split(',')[1] : pdfBase64;
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for(let i = 0; i < binaryString.length; i++){
      bytes[i] = binaryString.charCodeAt(i);
    }
    const fileName = `${interviewId}-${email}.pdf`;
    const { data, error } = await supabaseClient.storage.from('resume').upload(fileName, bytes, {
      contentType: 'application/pdf',
      upsert: true
    });
    if (error) {
      console.error('Error uploading resume:', error);
      return '';
    }
    return fileName;
  } catch (error) {
    console.error('Error uploading resume to storage:', error);
    return '';
  }
}
// Function to send confirmation email
async function sendCandidateConfirmationEmail(candidateEmail, candidateName, interviewDetails, interviewLink) {
  try {
    const { position, start_date, start_time, end_date, end_time } = interviewDetails;
    // Format dates and times
    const startDateTime = start_date && start_time ? `${new Date(start_date).toLocaleDateString()} at ${start_time}` : 'To be announced';
    const endDateTime = end_date && end_time ? `${new Date(end_date).toLocaleDateString()} at ${end_time}` : 'To be announced';
    // Use the generated interview link or fallback to default format
    const finalInterviewLink = interviewLink || `${Deno.env.get('SUPABASE_URL')}/interview/${interviewDetails.id}`;
    const emailBody = `<div style="text-align: center; margin-bottom: 30px;"><h1 style="color: #2563eb; margin-bottom: 10px;">Interview Confirmation</h1><p style="color: #6b7280; font-size: 16px;">Your application has been received successfully!</p></div><div style="background: #f8fafc; border-radius: 8px; padding: 20px; margin-bottom: 20px;"><h2 style="color: #1e293b; margin-top: 0;">Hello ${candidateName},</h2><p>Thank you for applying for the <strong>${position}</strong> position. Your application has been successfully submitted and we're excited to interview you!</p></div><div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin-bottom: 20px;"><h3 style="color: #1e293b; margin-top: 0;">📅 Interview Schedule</h3><p><strong>Start:</strong> ${startDateTime}</p><p><strong>End:</strong> ${endDateTime}</p><p style="color: #6b7280; font-size: 14px; margin-bottom: 0;">You can start your interview anytime during this period.</p></div><div style="background: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 16px; margin-bottom: 20px;"><h4 style="color: #92400e; margin-top: 0; display: flex; align-items: center;">⚠️ Important Notice</h4><p style="color: #92400e; margin-bottom: 0; font-size: 14px;">Once you start the interview, you must complete it in one session. You cannot pause or resume the interview.</p></div><div style="background: #f1f5f9; border-radius: 8px; padding: 16px; margin-bottom: 20px;"><h4 style="color: #334155; margin-top: 0;">📋 Instructions</h4><ul style="color: #475569; padding-left: 20px;"><li>This is an AI-based interview conducted on our online platform.</li><li>Use only the Google Chrome browser to attempt the interview.</li><li>You must share your entire screen at the beginning of the interview. The entire screen will be recorded.</li><li>There are three modes to answer: Audio, Text, and Code.</li><li>The AI interviewer will ask questions. Your microphone will turn on automatically. Once you finish speaking, click the mic button or the submit button to save your response.</li><li>Use the text editor and code editor when required.</li><li>After providing all inputs, click the submit button again to lock your response.</li><li>A chat button is available on the screen to view all transcripts for your reference.</li><li>Anti-cheating measures are active: no tab switching, screen switching, or window minimizing is allowed.</li><li>Using multiple screens is strictly prohibited.</li><li>Once the interview is completed, click the "End Interview" button.</li></ul></div><div style="text-align: center; margin: 30px 0;"><a href="${finalInterviewLink}" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 500;">Start Interview</a></div><div style="border-top: 1px solid #e2e8f0; padding-top: 20px; text-align: center;"><p style="color: #6b7280; font-size: 14px; margin-bottom: 10px;">If you have any questions or need to reschedule, please contact us immediately.</p><p style="color: #6b7280; font-size: 12px; margin-bottom: 0;">This is an automated message. Please do not reply to this email.</p></div><p>Best regards,<br>Shaurya Interviews Team</p>`;
    const response = await fetch('https://admin-northstar-prod.azurewebsites.net/api/sendEmail', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        user_email: candidateEmail,
        sender_email: "admin@skilljourney.in",
        cc_recipients: [],
        bcc_recipients: [],
        subject: "Interview Scheduled",
        body: emailBody,
        body_type: "HTML"
      })
    });
    const emailData = await response.json();
    if (!response.ok || !emailData.success) {
      console.error('Failed to send confirmation email:', emailData);
      return false;
    }
    return true;
  } catch (error) {
    console.error('Error sending confirmation email:', error);
    return false;
  }
}
const handler = async (req)=>{
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    const supabaseClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    const { interviewId, candidates } = await req.json();
    if (!interviewId || !candidates || !Array.isArray(candidates)) {
      return new Response(JSON.stringify({
        error: 'Missing required fields: interviewId and candidates array'
      }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }
    console.log(`Adding ${candidates.length} candidates to interview ${interviewId}`);
    // Get interview details for email
    const { data: interviewData, error: interviewError } = await supabaseClient.from('interview').select('*').eq('id', interviewId).single();
    if (interviewError || !interviewData) {
      console.error('Error fetching interview:', interviewError);
      return new Response(JSON.stringify({
        error: 'Interview not found'
      }), {
        status: 404,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }
    const addedCandidates = [];
    const emailResults = [];
    // Process each candidate
    for (const candidateData of candidates){
      try {
        console.log(`Processing candidate: ${candidateData.name}`);
        // Generate username
        const username = generateUsername();
        console.log(`Generated username: ${username} for email: ${candidateData.email}`);
        // Generate resume summary if resume file is provided
        let resumeSummary = '';
        if (candidateData.resumeFile) {
          try {
            resumeSummary = await generateResumeSummary(supabaseClient, candidateData.resumeFile);
          } catch (error) {
            console.error('Error processing resume:', error);
          }
        }
        // Generate interview link
        const interviewLink = await generateInterviewLink(supabaseClient, username);
        // Upload resume to storage
        let resumeFileName = '';
        if (candidateData.resumeFile && candidateData.email) {
          resumeFileName = await uploadResumeToStorage(supabaseClient, interviewId, candidateData.email, candidateData.resumeFile);
        }
        // Insert candidate into database
        const { data: candidate, error: candidateError } = await supabaseClient.from('candidate').insert({
          interview_id: interviewId,
          name: candidateData.name,
          email: candidateData.email || null,
          phone: candidateData.phone || null,
          username: username,
          location: candidateData.location || null,
          current_ctc: candidateData.currentCtc || null,
          expected_ctc: candidateData.expectedCtc || null,
          gender: candidateData.gender || 'Male',
          availability: candidateData.availability || 'Immediate',
          work_preference: candidateData.workPreference || 'Flexible',
          is_referred: candidateData.isReferred === 'yes',
          referer_name: candidateData.isReferred === 'yes' ? candidateData.referrerName : null,
          referer_email: candidateData.isReferred === 'yes' ? candidateData.referrerEmail : null,
          resume_summary: resumeSummary || null,
          link: interviewLink || null
        }).select().single();
        if (candidateError) {
          console.error('Error adding candidate:', candidateError);
          continue;
        }
        addedCandidates.push(candidate);
        // Send confirmation email if email is provided
        if (candidateData.email) {
          const emailSent = await sendCandidateConfirmationEmail(candidateData.email, candidateData.name, interviewData, interviewLink);
          emailResults.push({
            candidate: candidateData.name,
            email: candidateData.email,
            sent: emailSent
          });
        }
      } catch (error) {
        console.error(`Error processing candidate ${candidateData.name}:`, error);
      }
    }
    console.log(`Successfully added ${addedCandidates.length} candidates`);
    console.log(`Email results:`, emailResults);
    return new Response(JSON.stringify({
      success: true,
      message: `${addedCandidates.length} candidates added successfully`,
      candidates: addedCandidates,
      emailResults
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders
      }
    });
  } catch (error) {
    console.error('Error in add-candidates function:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message || 'Failed to add candidates'
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders
      }
    });
  }
};
serve(handler);
