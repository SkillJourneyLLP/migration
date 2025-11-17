// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verify, create } from "https://deno.land/x/djwt@v3.0.1/mod.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};
const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const jwtSecret = Deno.env.get("JWT_SECRET") || "default-secret-key-change-in-production";
const supabase = createClient(supabaseUrl, supabaseServiceKey);
const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(jwtSecret), {
  name: "HMAC",
  hash: "SHA-256"
}, false, [
  "sign",
  "verify"
]);
// Function to send candidate confirmation email using external API
async function sendCandidateConfirmationEmail(userEmail, userName, interviewLink, position, startDate, startTime, endDate, endTime) {
  // Format date and time for better readability
  const formatDateTime = (date, time)=>{
    return new Date(`${date}T${time}`).toLocaleString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  };
  const startDateTime = formatDateTime(startDate, startTime);
  const endDateTime = formatDateTime(endDate, endTime);
  const emailBody = `<div style="text-align: center; margin-bottom: 30px;"><h1 style="color: #2563eb; margin-bottom: 10px;">Interview Confirmation</h1><p style="color: #6b7280; font-size: 16px;">Your application has been received successfully!</p></div><div style="background: #f8fafc; border-radius: 8px; padding: 20px; margin-bottom: 20px;"><h2 style="color: #1e293b; margin-top: 0;">Hello ${userName},</h2><p>Thank you for applying for the <strong>${position}</strong> position. Your application has been successfully submitted and we're excited to interview you!</p></div><div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin-bottom: 20px;"><h3 style="color: #1e293b; margin-top: 0;">📅 Interview Schedule</h3><p><strong>Start:</strong> ${startDateTime}</p><p><strong>End:</strong> ${endDateTime}</p><p style="color: #6b7280; font-size: 14px; margin-bottom: 0;">You can start your interview anytime during this period.</p></div><div style="background: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 16px; margin-bottom: 20px;"><h4 style="color: #92400e; margin-top: 0; display: flex; align-items: center;">⚠️ Important Notice</h4><p style="color: #92400e; margin-bottom: 0; font-size: 14px;">Once you start the interview, you must complete it in one session. You cannot pause or resume the interview.</p></div><div style="background: #f1f5f9; border-radius: 8px; padding: 16px; margin-bottom: 20px;"><h4 style="color: #334155; margin-top: 0;">📋 Instructions</h4><ul style="color: #475569; padding-left: 20px;"><li>This is an AI-based interview conducted on our online platform.</li><li>Use only the Google Chrome browser to attempt the interview.</li><li>You must share your entire screen at the beginning of the interview. The entire screen will be recorded.</li><li>There are three modes to answer: Audio, Text, and Code.</li><li>The AI interviewer will ask questions. Your microphone will turn on automatically. Once you finish speaking, click the mic button or the submit button to save your response.</li><li>Use the text editor and code editor when required.</li><li>After providing all inputs, click the submit button again to lock your response.</li><li>A chat button is available on the screen to view all transcripts for your reference.</li><li>Anti-cheating measures are active: no tab switching, screen switching, or window minimizing is allowed.</li><li>Using multiple screens is strictly prohibited.</li><li>Once the interview is completed, click the "End Interview" button.</li></ul></div><div style="text-align: center; margin: 30px 0;"><a href="${interviewLink}" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 500;">Start Interview</a></div><div style="border-top: 1px solid #e2e8f0; padding-top: 20px; text-align: center;"><p style="color: #6b7280; font-size: 14px; margin-bottom: 10px;">If you have any questions or need to reschedule, please contact us immediately.</p><p style="color: #6b7280; font-size: 12px; margin-bottom: 0;">This is an automated message. Please do not reply to this email.</p></div><p>Best regards,<br>Shaurya Interviews Team</p>`;
  try {
    const response = await fetch("https://admin-northstar-prod.azurewebsites.net/api/sendEmail", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        user_email: userEmail,
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
      console.error("Failed to send confirmation email:", emailData);
      return false;
    }
    return true;
  } catch (error) {
    console.error("Error sending confirmation email:", error);
    return false;
  }
}
serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({
        error: "Authorization required"
      }), {
        status: 401,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const token = authHeader.replace("Bearer ", "");
    const payload = await verify(token, key);
    const userId = payload.userId;
    const { action, ...data } = await req.json();
    switch(action){
      case "fetch":
        return await handleFetchInterviews(userId, data.page, data.limit);
      case "create":
        return await handleCreateInterview(userId, data);
      case "update":
        return await handleUpdateInterview(userId, data);
      case "delete":
        return await handleDeleteInterview(userId, data.id);
      case "archive":
        return await handleArchiveInterview(userId, data.id);
      case "updateStatus":
        return await handleUpdateStatus(userId, data.id, data.deactive);
      case "fetchCandidates":
        return await handleFetchCandidates(userId, data.interviewId);
      case "addCandidates":
        return await handleAddCandidates(userId, data.interviewId, data.candidates);
      default:
        return new Response(JSON.stringify({
          error: "Invalid action"
        }), {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
    }
  } catch (error) {
    console.error("Interviews function error:", error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});
async function handleFetchInterviews(userId, page = 1, limit = 10) {
  // First get the user's organization_id
  const { data: user, error: userError } = await supabase.from("users").select("organization_id").eq("id", userId).single();
  if (userError || !user) throw new Error("User not found");
  // Calculate pagination
  const from = (page - 1) * limit;
  const to = from + limit - 1;
  console.log(`Fetching interviews - page: ${page}, limit: ${limit}, from: ${from}, to: ${to}`);
  // Get total count of visible interviews
  const { count, error: countError } = await supabase.from("interview").select("*", {
    count: 'exact',
    head: true
  }).eq("organization_id", user.organization_id).eq("is_deleted", false).eq("is_archived", false);
  if (countError) throw countError;
  // Fetch paginated interviews for the org
  const { data: interviews, error: interviewsError } = await supabase.from("interview").select("*").eq("organization_id", user.organization_id).eq("is_deleted", false).eq("is_archived", false).order("created_at", {
    ascending: false
  }).range(from, to);
  if (interviewsError) throw interviewsError;
  const totalPages = Math.ceil((count || 0) / limit);
  console.log(`Fetched ${interviews?.length || 0} interviews (total: ${count}, pages: ${totalPages})`);
  return new Response(JSON.stringify({
    interviews: interviews || [],
    totalCount: count || 0,
    totalPages,
    currentPage: page
  }), {
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}
async function handleCreateInterview(userId, interviewData) {
  // First get the user's organization_id
  const { data: user, error: userError } = await supabase.from("users").select("organization_id").eq("id", userId).single();
  if (userError || !user) throw new Error("User not found");
  // Always generate application link
  const payload = {
    interviewId: "placeholder",
    type: "application_access",
    exp: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60
  };
  const token = await create({
    alg: "HS256",
    typ: "JWT"
  }, payload, key);
  const applicationLink = `https://apply.hyrai.ai/external-auth?access_token=${token}`;
  // Insert interview (removed evaluation_criteria and report_gen_criteria fields)
  const { data: interview, error: interviewError } = await supabase.from("interview").insert({
    position: interviewData.position,
    duration: parseInt(interviewData.duration),
    start_date: interviewData.startDate,
    start_time: interviewData.startTime,
    end_date: interviewData.endDate,
    end_time: interviewData.endTime,
    job_description: interviewData.jobDescription,
    opening_statement: interviewData.openingStatement,
    faq: interviewData.faq,
    language: interviewData.language,
    noteForUser: interviewData.noteForUser,
    psychometric: interviewData.psychometric === true,
    user_id: userId,
    organization_id: user.organization_id,
    status: "Scheduled",
    application_link: applicationLink,
    deactive: interviewData.deactive || false
  }).select().single();
  if (interviewError) throw interviewError;
  // Update application link with actual interview ID
  const updatedPayload = {
    interviewId: interview.id,
    type: "application_access",
    exp: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60
  };
  let finalApplicationLink;
  if (interviewData.deactive) {
    // Add disabled flag for deactivated interviews
    const disabledPayload = {
      ...updatedPayload,
      disabled: true
    };
    const disabledToken = await create({
      alg: "HS256",
      typ: "JWT"
    }, disabledPayload, key);
    finalApplicationLink = `https://apply.hyrai.ai/external-auth?access_token=${disabledToken}&disabled`;
  } else {
    const updatedToken = await create({
      alg: "HS256",
      typ: "JWT"
    }, updatedPayload, key);
    finalApplicationLink = `https://apply.hyrai.ai/external-auth?access_token=${updatedToken}`;
  }
  // Update the interview with the correct application link
  const { error: updateError } = await supabase.from("interview").update({
    application_link: finalApplicationLink
  }).eq("id", interview.id);
  if (updateError) throw updateError;
  // Insert candidates with generated JWT links
  if (interviewData.candidates && interviewData.candidates.length > 0) {
    const candidatesData = await Promise.all(interviewData.candidates.map(async (candidate)=>{
      // Generate JWT token for this candidate
      const payload = {
        username: candidate.username,
        interviewId: interview.id,
        type: "interview_access",
        exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60
      };
      const token = await create({
        alg: "HS256",
        typ: "JWT"
      }, payload, key);
      let link = `https://apply.hyrai.ai/external-auth?access_token=${token}`;
      // If interview is deactivated, append 'disabled' and encrypt
      if (interviewData.deactive) {
        const disabledPayload = {
          ...payload,
          disabled: true
        };
        const disabledToken = await create({
          alg: "HS256",
          typ: "JWT"
        }, disabledPayload, key);
        link = `https://apply.hyrai.ai/external-auth?access_token=${disabledToken}&disabled`;
      }
      return {
        interview_id: interview.id,
        name: candidate.name,
        email: candidate.email,
        phone: candidate.phone,
        username: candidate.username,
        resume_summary: candidate.resumeSummary,
        link: link
      };
    }));
    const { error: candidatesError } = await supabase.from("candidate").insert(candidatesData);
    if (candidatesError) throw candidatesError;
    // Get organization name
    const { data: orgData } = await supabase.from("organization").select("name").eq("id", user.organization_id).single();
    // Send confirmation emails to candidates
    for (const candidateData of candidatesData){
      try {
        const { error: emailError } = await supabase.functions.invoke("send-interview-confirmation", {
          body: {
            candidateEmail: candidateData.email,
            candidateName: candidateData.name,
            interviewLink: candidateData.link,
            position: interviewData.position,
            startDate: interviewData.startDate,
            startTime: interviewData.startTime,
            endDate: interviewData.endDate,
            endTime: interviewData.endTime,
            adminNote: interviewData.noteForUser,
            organizationName: orgData?.name
          }
        });
        if (emailError) {
          console.error("Failed to send email to", candidateData.email, ":", emailError);
        } else {
          console.log("Email sent successfully to", candidateData.email);
        }
      } catch (error) {
        console.error("Error sending email to", candidateData.email, ":", error);
      }
    }
  }
  // Insert evaluation criteria if any
  if (interviewData.evaluationCriteria && interviewData.evaluationCriteria.length > 0) {
    const criteriaData = interviewData.evaluationCriteria.map((criteria)=>({
        interview_id: interview.id,
        criteria_name: criteria.criteria_name,
        weightage: criteria.weightage
      }));
    const { error: criteriaError } = await supabase.from("eval_criteria").insert(criteriaData);
    if (criteriaError) throw criteriaError;
  }
  // Insert constraints if any (with support for custom questions)
  if (interviewData.constraints && interviewData.constraints.length > 0) {
    const constraintsData = interviewData.constraints.map((constraint)=>{
      // Normalize the constraint type - replace hyphens with underscores, lowercase, and trim
      const normalizedType = (constraint.type || "").toString().toLowerCase().trim().replace(/-/g, "_");
      // Map constraint types to database enum values
      const typeMapping = {
        technical: "technical",
        coding: "coding",
        behavioral: "behavioral",
        situational: "situational",
        psychometric: "psychometric",
        behavioral_assessment: "behavioral_assessment",
        resume_based: "resume_based",
        "resume based": "resume_based",
        custom: "custom"
      };
      return {
        interview_id: interview.id,
        type: typeMapping[normalizedType] || "technical",
        difficulty: (constraint.difficulty || "medium").toString().toLowerCase(),
        topic: constraint.topic
      };
    });
    const { error: constraintsError } = await supabase.from("interview_constraints").insert(constraintsData);
    if (constraintsError) throw constraintsError;
  }
  return new Response(JSON.stringify({
    interview
  }), {
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}
async function handleUpdateInterview(userId, data) {
  const { id, constraints, evaluationCriteria, deactive, psychometric, ...interviewUpdate } = data;
  // First get the user's organization_id
  const { data: user, error: userError } = await supabase.from("users").select("organization_id").eq("id", userId).single();
  if (userError || !user) throw new Error("User not found");
  // Verify interview belongs to the same organization
  const { data: interview, error: verifyError } = await supabase.from("interview").select("id").eq("id", id).eq("organization_id", user.organization_id).single();
  if (verifyError || !interview) {
    throw new Error("Interview not found or access denied");
  }
  // Update interview and handle deactive status and psychometric
  const updateData = {
    ...interviewUpdate,
    deactive: deactive === true ? true : false,
    updated_at: new Date().toISOString()
  };
  // Only add psychometric if it's explicitly provided
  if (psychometric !== undefined) {
    updateData.psychometric = psychometric === true;
  }
  const { error: interviewError } = await supabase.from("interview").update(updateData).eq("id", id);
  if (interviewError) throw interviewError;
  // If deactive status changed, update all candidate links and application link
  if (deactive !== undefined) {
    // Get the current interview data to update application link
    const { data: interviewData, error: interviewFetchError } = await supabase.from("interview").select("*").eq("id", id).single();
    if (!interviewFetchError && interviewData && interviewData.application_link) {
      // Update application link based on deactive status
      const appPayload = {
        interviewId: id,
        type: "application_access",
        exp: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60
      };
      let newApplicationLink;
      if (deactive) {
        const disabledAppPayload = {
          ...appPayload,
          disabled: true
        };
        const disabledAppToken = await create({
          alg: "HS256",
          typ: "JWT"
        }, disabledAppPayload, key);
        newApplicationLink = `https://apply.hyrai.ai/external-auth?access_token=${disabledAppToken}&disabled`;
      } else {
        const appToken = await create({
          alg: "HS256",
          typ: "JWT"
        }, appPayload, key);
        newApplicationLink = `https://apply.hyrai.ai/external-auth?access_token=${appToken}`;
      }
      // Update interview with new application link
      await supabase.from("interview").update({
        application_link: newApplicationLink
      }).eq("id", id);
    }
    // Update candidate links
    const { data: existingCandidates, error: fetchError } = await supabase.from("candidate").select("*").eq("interview_id", id);
    if (!fetchError && existingCandidates) {
      for (const candidate of existingCandidates){
        const payload = {
          username: candidate.username,
          interviewId: id,
          type: "interview_access",
          exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60
        };
        let newLink;
        if (deactive) {
          // Add disabled flag and encrypt
          const disabledPayload = {
            ...payload,
            disabled: true
          };
          const disabledToken = await create({
            alg: "HS256",
            typ: "JWT"
          }, disabledPayload, key);
          newLink = `https://apply.hyrai.ai/external-auth?access_token=${disabledToken}&disabled`;
        } else {
          // Remove disabled flag
          const token = await create({
            alg: "HS256",
            typ: "JWT"
          }, payload, key);
          newLink = `https://apply.hyrai.ai/external-auth?access_token=${token}`;
        }
        // Update candidate link
        await supabase.from("candidate").update({
          link: newLink
        }).eq("id", candidate.id);
      }
    }
  }
  // Delete existing constraints
  const { error: deleteConstraintsError } = await supabase.from("interview_constraints").delete().eq("interview_id", id);
  if (deleteConstraintsError) throw deleteConstraintsError;
  // Insert new constraints
  if (constraints && constraints.length > 0) {
    const constraintsData = constraints.map((constraint)=>{
      // Normalize the constraint type - replace hyphens with underscores, lowercase, and trim
      const normalizedType = (constraint.type || "").toString().toLowerCase().trim().replace(/-/g, "_");
      // Map constraint types to database enum values
      const typeMapping = {
        technical: "technical",
        coding: "coding",
        behavioral: "behavioral",
        situational: "situational",
        psychometric: "psychometric",
        behavioral_assessment: "behavioral_assessment",
        resume_based: "resume_based",
        "resume based": "resume_based",
        custom: "custom"
      };
      return {
        interview_id: id,
        type: typeMapping[normalizedType] || "technical",
        difficulty: (constraint.difficulty || "medium").toString().toLowerCase(),
        topic: constraint.topic || null
      };
    });
    const { error: constraintsError } = await supabase.from("interview_constraints").insert(constraintsData);
    if (constraintsError) throw constraintsError;
  }
  // Update evaluation criteria if provided
  if (evaluationCriteria && Array.isArray(evaluationCriteria)) {
    // Delete existing criteria
    await supabase.from("eval_criteria").delete().eq("interview_id", id);
    // Insert new criteria
    const criteriaData = evaluationCriteria.map((criteria)=>({
        interview_id: id,
        criteria_name: criteria.criteria_name,
        weightage: criteria.weightage
      }));
    const { error: criteriaError } = await supabase.from("eval_criteria").insert(criteriaData);
    if (criteriaError) throw criteriaError;
  }
  return new Response(JSON.stringify({
    success: true
  }), {
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}
async function handleDeleteInterview(userId, interviewId) {
  // First get the user's organization_id
  const { data: user, error: userError } = await supabase.from("users").select("organization_id").eq("id", userId).single();
  if (userError || !user) throw new Error("User not found");
  // Mark as deleted instead of actually deleting
  const { error } = await supabase.from("interview").update({
    is_deleted: true
  }).eq("id", interviewId).eq("organization_id", user.organization_id);
  if (error) throw error;
  return new Response(JSON.stringify({
    success: true
  }), {
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}
async function handleArchiveInterview(userId, interviewId) {
  // First get the user's organization_id
  const { data: user, error: userError } = await supabase.from("users").select("organization_id").eq("id", userId).single();
  if (userError || !user) throw new Error("User not found");
  // Mark as archived
  const { error } = await supabase.from("interview").update({
    is_archived: true
  }).eq("id", interviewId).eq("organization_id", user.organization_id);
  if (error) throw error;
  return new Response(JSON.stringify({
    success: true
  }), {
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}
async function handleUpdateStatus(userId, interviewId, deactive) {
  // First get the user's organization_id
  const { data: user, error: userError } = await supabase.from("users").select("organization_id").eq("id", userId).single();
  if (userError || !user) throw new Error("User not found");
  // Update deactive status
  const { error } = await supabase.from("interview").update({
    deactive
  }).eq("id", interviewId).eq("organization_id", user.organization_id);
  if (error) throw error;
  return new Response(JSON.stringify({
    success: true
  }), {
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}
async function handleFetchCandidates(userId, interviewId) {
  // First get the user's organization_id
  const { data: user, error: userError } = await supabase.from("users").select("organization_id").eq("id", userId).single();
  if (userError || !user) throw new Error("User not found");
  // Verify the interview belongs to the same organization
  const { data: interview, error: interviewError } = await supabase.from("interview").select("id").eq("id", interviewId).eq("organization_id", user.organization_id).single();
  if (interviewError || !interview) {
    throw new Error("Interview not found or unauthorized");
  }
  const { data, error } = await supabase.from("candidate").select("*").eq("interview_id", interviewId).order("created_at", {
    ascending: false
  });
  if (error) throw error;
  return new Response(JSON.stringify({
    candidates: data
  }), {
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}
// Handler to add candidates to an existing interview
async function handleAddCandidates(userId, interviewId, candidates) {
  try {
    // Get user organization
    const { data: user, error: userError } = await supabase.from("users").select("organization_id").eq("id", userId).single();
    if (userError || !user) {
      throw new Error("User not found");
    }
    // Verify the interview belongs to the user's organization
    const { data: interview, error: interviewError } = await supabase.from("interview").select("id, user_id, position, start_date, start_time, end_date, end_time, noteForUser").eq("id", interviewId).single();
    if (interviewError || !interview) {
      throw new Error("Interview not found");
    }
    // Check if the interview belongs to the user's organization
    const { data: interviewUser, error: interviewUserError } = await supabase.from("users").select("organization_id").eq("id", interview.user_id).single();
    if (interviewUserError || !interviewUser || interviewUser.organization_id !== user.organization_id) {
      throw new Error("Unauthorized access to interview");
    }
    // Add candidates to the interview
    const candidatesWithInterview = candidates.map((candidate)=>({
        ...candidate,
        interview_id: interviewId
      }));
    const { data: insertedCandidates, error: candidatesError } = await supabase.from("candidate").insert(candidatesWithInterview).select();
    if (candidatesError) {
      console.error("Error inserting candidates:", candidatesError);
      throw new Error("Failed to add candidates");
    }
    // Get interview deactive status
    const { data: interviewData, error: interviewDataError } = await supabase.from("interview").select("deactive").eq("id", interviewId).single();
    if (interviewDataError) {
      console.error("Error fetching interview deactive status:", interviewDataError);
    }
    const isDeactive = interviewData?.deactive || false;
    // Get organization name
    const { data: orgData } = await supabase.from("organization").select("name").eq("id", user.organization_id).single();
    // Generate interview links and send confirmation emails for each candidate
    for (const candidate of insertedCandidates){
      try {
        // Generate JWT token for the candidate
        const payload = {
          username: candidate.username,
          interviewId: interviewId,
          type: "interview_access",
          exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60
        };
        let interviewLink;
        if (isDeactive) {
          const disabledPayload = {
            ...payload,
            disabled: true
          };
          const disabledToken = await create({
            alg: "HS256",
            typ: "JWT"
          }, disabledPayload, key);
          interviewLink = `https://apply.hyrai.ai/external-auth?access_token=${disabledToken}&disabled`;
        } else {
          const token = await create({
            alg: "HS256",
            typ: "JWT"
          }, payload, key);
          interviewLink = `https://apply.hyrai.ai/external-auth?access_token=${token}`;
        }
        // Update candidate with the interview link
        await supabase.from("candidate").update({
          link: interviewLink
        }).eq("id", candidate.id);
        // Send confirmation email
        const { error: emailError } = await supabase.functions.invoke("send-interview-confirmation", {
          body: {
            candidateEmail: candidate.email,
            candidateName: candidate.name,
            interviewLink: interviewLink,
            position: interview.position,
            startDate: interview.start_date,
            startTime: interview.start_time,
            endDate: interview.end_date,
            endTime: interview.end_time,
            adminNote: interview.noteForUser,
            organizationName: orgData?.name
          }
        });
        if (emailError) {
          console.error("Failed to send email to", candidate.email, ":", emailError);
        } else {
          console.log(`Confirmation email sent to ${candidate.email}`);
        }
        console.log(`Confirmation email sent to ${candidate.email}`);
      } catch (emailError) {
        console.error(`Failed to send email to ${candidate.email}:`, emailError);
      // Continue with other candidates even if one email fails
      }
    }
    return new Response(JSON.stringify({
      success: true,
      message: `${candidates.length} candidates added successfully`,
      candidates: insertedCandidates
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders
      }
    });
  } catch (error) {
    console.error("Error adding candidates:", error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message || "Failed to add candidates"
    }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders
      }
    });
  }
}
