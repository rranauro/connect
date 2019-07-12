var assert = require('assert');
var util = require('../index');
var _ = require('underscore');
var connect = require('../index');

/** create .connectrc in the root directory with your credentials and connection string.
module.exports = {
	username:'user_name', 
	password:'password',
	MONGO_URL: "mongodb://localhost:27017/your_db",
};
**/

var env = require('../.connectrc');
var auth = "Basic " + new Buffer(env.username + ':' + env.password).toString('base64');
var mydb = connect( auth, env.MONGO_URL );

describe('connect', function() {
	var docs = _.range(100).map(function(id) {
		return {_id: id, value: id};
	});
	
	it('connect', function(done) {
		mydb.auth(function(err, db) {
			assert.equal(1, 1);
			done();
		});
	});
	
	it('drop "test_docs", "test_docs_copy"', function(done) {
		mydb.collection( 'test_docs' ).drop(function(err, response) {
			assert.equal( err ? err.errmsg === 'ns not found' : true, true);
		});
		
		mydb.collection( 'test_docs_copy' ).drop(function(err, response) {
			assert.equal( err ? err.errmsg === 'ns not found' : true, true);
			done();
		});
	});
	
	it('create a collection with 100 documents', function(done) {
		mydb.create('test_docs', docs, function(err, results) {
			console.log(err, results);
			assert.equal(results[0].ok, 1);
			done();
		});
	});
	
	it('all_ids', function(done) {
		mydb.all_ids('test_docs', function(err, results) {
			assert.equal( results.length, 100 );
			done();
		});
	});
	
	it('bulkSave', function(done) {
		this.timeout(0);
		mydb.options({create: 47}).bulkSave('test_docs', 'test_docs_copy', function(err, response) {
			assert.equal(response && response.result.ok, 1);
			done();
		});
	});
	
	it('bulkUpdate', function(done) {
		this.timeout(0);
		mydb.updateAll( 'test_docs_copy', [0, 1, 2, 3].map(function(id) {
			return {_id: id, today: new Date().toString()};
		}), function(err, response) {
			assert.equal(response && response.result.n, 4);
			done();
		});
	});
	
	it('filter', function(done) {
		mydb.filter('test_docs', {}, function(doc) {
			return doc._id === 99;
		}, function(err, docs) {
			assert.equal(docs.length === 1 && docs[0].value === 99, true);
			done();
		});
	});
	
	it('close', function(done) {
		mydb.close(done);		
	});
});
