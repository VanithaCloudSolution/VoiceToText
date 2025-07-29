public with sharing class AudioFileUploader {
    @AuraEnabled
    public static String saveAudioFile(String recordId, String fileName, String base64Data) {
        try {
            ContentVersion content = new ContentVersion();
            content.Title = fileName;
            content.PathOnClient = fileName;
            content.VersionData = EncodingUtil.base64Decode(base64Data);
            content.FirstPublishLocationId = recordId; // Attaches to record
            insert content;
            
            return 'Success';
        } catch (Exception e) {
            return 'Error: ' + e.getMessage();
        }
    }
}