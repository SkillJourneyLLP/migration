import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.53.0';
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
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const geminiApiKey = Deno.env.get('GEMINI_API_KEY');
    if (!geminiApiKey) {
      console.error('GEMINI_API_KEY not found');
      return new Response(JSON.stringify({
        error: 'GEMINI_API_KEY not configured'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    console.log('Processing report for candidate:', candidateId, 'interview:', interviewId);
    // Step 1: Get transcript content from file_path column
    const { data: transcript, error: transcriptError } = await supabase.from('transcripts').select('file_path, candidate_id').eq('candidate_id', candidateId).eq('interview_id', interviewId).single();
    if (transcriptError || !transcript?.file_path) {
      console.error('Transcript not found:', transcriptError);
      return new Response(JSON.stringify({
        error: 'Transcript not found for this candidate'
      }), {
        status: 404,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Use file_path content directly as transcript
    const transcriptContent = transcript.file_path;
    console.log('Transcript content loaded, length:', transcriptContent.length);
    // Step 2: Get evaluation criteria for this interview
    const { data: evalCriteria, error: criteriaError } = await supabase.from('eval_criteria').select('*').eq('interview_id', interviewId);
    if (criteriaError || !evalCriteria?.length) {
      console.error('Evaluation criteria not found:', criteriaError);
      return new Response(JSON.stringify({
        error: 'Evaluation criteria not found for this interview'
      }), {
        status: 404,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    console.log('Found', evalCriteria.length, 'evaluation criteria');
    // Step 3: Process each evaluation criteria with LLM
    const evaluationResults = [];
    for (const criteria of evalCriteria){
      console.log('Processing criteria:', criteria.criteria_name);
      const prompt = `
SCORING GUIDELINES - BE EXTREMELY STRICT:
- 0-2: Complete failure, no understanding, did not attempt or completely wrong
- 3-4: Poor performance, minimal understanding, significant gaps
- 5-6: Below average, some understanding but major deficiencies 
- 7-8: Good performance, solid understanding with minor issues
- 9-10: Excellent, exceptional understanding and execution

Based on the following interview transcript, evaluate the candidate's performance on "${criteria.criteria_name}" and assign a score out of 10.

Interview Transcript:
${transcriptContent}

Evaluation Criteria: ${criteria.criteria_name}

Please provide:
1. Score (0-10): 
2. Justification (2-3 sentences explaining why this score was given):

Format your response as:
Score: [number]
Justification: [explanation]
`;
      try {
        const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-001:generateContent?key=' + geminiApiKey, {
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
            ]
          })
        });
        const data = await response.json();
        const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        // Parse the response
        const scoreMatch = content.match(/Score:\s*(\d+)/i);
        const justificationMatch = content.match(/Justification:\s*(.+)/is);
        const score = scoreMatch ? parseInt(scoreMatch[1]) : 0;
        const justification = justificationMatch ? justificationMatch[1].trim() : 'No justification provided';
        evaluationResults.push({
          interview_id: interviewId,
          eval_criteria_id: criteria.id,
          candidate_id: candidateId,
          eval_criteria: criteria.criteria_name,
          score: score.toString(),
          justification: justification,
          weightage: criteria.weightage
        });
        console.log('Evaluated criteria:', criteria.criteria_name, 'Score:', score);
      } catch (error) {
        console.error('Error evaluating criteria:', criteria.criteria_name, error);
        // Add a failed evaluation
        evaluationResults.push({
          interview_id: interviewId,
          eval_criteria_id: criteria.id,
          candidate_id: candidateId,
          eval_criteria: criteria.criteria_name,
          score: '0',
          justification: 'Failed to evaluate due to processing error',
          weightage: criteria.weightage
        });
      }
    }
    // Step 4: Save evaluation results to report_eval_criteria table
    const { error: saveError } = await supabase.from('report_eval_criteria').insert(evaluationResults);
    if (saveError) {
      console.error('Error saving evaluation results:', saveError);
      return new Response(JSON.stringify({
        error: 'Failed to save evaluation results'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    console.log('Saved', evaluationResults.length, 'evaluation results');
    // Step 5: Parse Q&A pairs from transcript and save to interview_qa table
    const qaPrompt = `
Extract all question-answer pairs from this interview transcript. Only include questions asked by the AI interviewer and the candidate's direct responses.

Interview Transcript:
${transcriptContent}

Format your response as JSON array:
[
  {
    "question": "What is your experience with...",
    "answer": "I have worked with..."
  }
]

Only return the JSON array, no other text.
`;
    let qaWithAnalysis = [];
    try {
      const qaResponse = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-001:generateContent?key=' + geminiApiKey, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: qaPrompt
                }
              ]
            }
          ]
        })
      });
      const qaData = await qaResponse.json();
      const qaContent = qaData.candidates?.[0]?.content?.parts?.[0]?.text || '';
      let qaPairs = [];
      try {
        // Clean the response to extract JSON
        const jsonMatch = qaContent.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          qaPairs = JSON.parse(jsonMatch[0]);
        }
      } catch (parseError) {
        console.error('Error parsing Q&A JSON:', parseError);
      }
      console.log('Extracted', qaPairs.length, 'Q&A pairs');
      // Step 6: Generate detailed analysis for each Q&A pair
      for(let index = 0; index < qaPairs.length; index++){
        const qa = qaPairs[index];
        const analysisPrompt = `
Provide a detailed analysis of this interview question and answer pair. Focus on the candidate's technical competency, communication skills, and overall response quality.

Question: ${qa.question}
Answer: ${qa.answer}

Provide a comprehensive analysis (3-4 sentences) covering:
1. Technical accuracy and depth of knowledge
2. Communication clarity and structure
3. Overall quality of the response
4. Areas for improvement (if any)
`;
        try {
          const analysisResponse = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-001:generateContent?key=' + geminiApiKey, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              contents: [
                {
                  parts: [
                    {
                      text: analysisPrompt
                    }
                  ]
                }
              ]
            })
          });
          const analysisData = await analysisResponse.json();
          const detailedAnalysis = analysisData.candidates?.[0]?.content?.parts?.[0]?.text || 'Analysis not available';
          qaWithAnalysis.push({
            interview_id: interviewId,
            candidate_id: candidateId,
            question: qa.question,
            answer: qa.answer,
            detailed_analysis: detailedAnalysis,
            result_id: candidateId,
            order: index + 1
          });
        } catch (error) {
          console.error('Error generating analysis for Q&A:', error);
          qaWithAnalysis.push({
            interview_id: interviewId,
            candidate_id: candidateId,
            question: qa.question,
            answer: qa.answer,
            detailed_analysis: 'Analysis could not be generated due to processing error',
            result_id: candidateId,
            order: index + 1
          });
        }
      }
      // Save Q&A pairs with analysis
      if (qaWithAnalysis.length > 0) {
        const { error: qaError } = await supabase.from('interview_qa').insert(qaWithAnalysis);
        if (qaError) {
          console.error('Error saving Q&A data:', qaError);
        } else {
          console.log('Saved', qaWithAnalysis.length, 'Q&A pairs with analysis');
        }
      }
    } catch (error) {
      console.error('Error processing Q&A pairs:', error);
    }
    // Step 7: Calculate final score and recommendation (weighted average)
    let totalWeightedScore = 0;
    let totalWeight = 0;
    for (const result of evaluationResults){
      const score = parseInt(result.score);
      const weight = result.weightage;
      totalWeightedScore += score * weight;
      totalWeight += weight;
    }
    // Calculate weighted average out of 100
    const finalScore = totalWeight > 0 ? Math.round(totalWeightedScore / totalWeight * 10) : 0;
    let recommendation = 'Unfit';
    if (finalScore >= 80) {
      recommendation = 'Superstar';
    } else if (finalScore >= 70) {
      recommendation = 'Excellent Fit';
    } else if (finalScore >= 60) {
      recommendation = 'Good Fit';
    } else if (finalScore >= 50) {
      recommendation = 'Fit';
    } else if (finalScore >= 40) {
      recommendation = 'Somewhat Fit';
    }
    console.log('Final calculated score:', finalScore, 'Recommendation:', recommendation);
    // Step 8: Update results table
    const { error: updateError } = await supabase.from('results').update({
      score: finalScore.toString(),
      recommendation: recommendation,
      updated_at: new Date().toISOString()
    }).eq('candidate_id', candidateId).eq('interview_id', interviewId);
    if (updateError) {
      console.error('Error updating results:', updateError);
      return new Response(JSON.stringify({
        error: 'Failed to update results'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Step 9: Generate executive summary from Q&A pairs
    try {
      const summaryPrompt = `
Based on the following interview Q&A pairs, generate a comprehensive executive summary for this candidate's interview performance.

Q&A Pairs:
${qaWithAnalysis.map((qa)=>`Q: ${qa.question}\nA: ${qa.answer}`).join('\n\n') || 'No Q&A pairs available'}

Please provide:
1. A brief overall assessment (2-3 sentences)
2. Key strengths demonstrated
3. Areas of concern or improvement needed
4. Final recommendation summary

Format as a well-structured report summary that would be useful for hiring managers.
`;
      const summaryResponse = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-001:generateContent?key=' + geminiApiKey, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: summaryPrompt
                }
              ]
            }
          ]
        })
      });
      const summaryData = await summaryResponse.json();
      const executiveSummary = summaryData.candidates?.[0]?.content?.parts?.[0]?.text || 'Executive summary could not be generated';
      // Update results table with executive summary
      const { error: summaryUpdateError } = await supabase.from('results').update({
        report_link: executiveSummary
      }).eq('candidate_id', candidateId).eq('interview_id', interviewId);
      if (summaryUpdateError) {
        console.error('Error updating executive summary:', summaryUpdateError);
      } else {
        console.log('Executive summary generated and saved');
      }
    } catch (error) {
      console.error('Error generating executive summary:', error);
    }
    console.log('Report processing completed successfully');
    return new Response(JSON.stringify({
      success: true,
      score: finalScore,
      recommendation: recommendation,
      evaluationCount: evaluationResults.length,
      qaCount: qaWithAnalysis.length
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Error in process-report function:', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
