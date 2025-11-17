import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};
const handler = async (req)=>{
  console.log("Get organization name request received");
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({
      error: "Method not allowed"
    }), {
      status: 405,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders
      }
    });
  }
  try {
    const { interviewId } = await req.json();
    if (!interviewId) {
      return new Response(JSON.stringify({
        error: "Interview ID is required"
      }), {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders
        }
      });
    }
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Missing Supabase environment variables");
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    console.log("Fetching interview with ID:", interviewId);
    // Fetch interview to get organization_id
    const { data: interview, error: interviewError } = await supabase.from("interview").select("organization_id").eq("id", interviewId).single();
    if (interviewError) {
      console.error("Error fetching interview:", interviewError);
      throw new Error("Failed to fetch interview details");
    }
    if (!interview || !interview.organization_id) {
      console.log("No organization found for this interview");
      return new Response(JSON.stringify({
        success: true,
        organizationName: "Shaurya Interviews" // Default fallback
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders
        }
      });
    }
    console.log("Fetching organization with ID:", interview.organization_id);
    // Fetch organization name
    const { data: organization, error: orgError } = await supabase.from("organizations").select("name").eq("id", interview.organization_id).single();
    if (orgError) {
      console.error("Error fetching organization:", orgError);
      throw new Error("Failed to fetch organization details");
    }
    console.log("Organization found:", organization.name);
    return new Response(JSON.stringify({
      success: true,
      organizationName: organization.name || "Shaurya Interviews"
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders
      }
    });
  } catch (error) {
    console.error("Error in get-organization-name function:", error);
    return new Response(JSON.stringify({
      success: false,
      error: "Failed to fetch organization name",
      details: error.message
    }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders
      }
    });
  }
};
serve(handler);
